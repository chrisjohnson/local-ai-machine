/**
 * semantic-repeat-guard: catches semantic (not just literal) repeats in
 * tool calls - e.g. "check disk space" vs "how much storage is free",
 * which pi-loop-police's Jaccard-similarity-based detectors can't see
 * (near-zero word overlap despite identical meaning). Complementary to
 * pi-loop-police, not a replacement - see the M-042 and follow-on fleet
 * cards' decision logs for the full comparison and why both exist.
 *
 * Design (per M-041's confirmed pattern, all APIs below verified directly
 * against @earendil-works/pi-coding-agent's own type definitions and its
 * bundled examples/extensions/custom-compaction.ts, not assumed):
 * - Per-session rolling window of recent tool calls, keyed by the real
 *   session id from ctx.sessionManager.getSessionId() - deliberately NOT
 *   module-level singleton state, which is the exact bug already found
 *   this session in pi-claude-bridge's own `sharedSession` variable
 *   (silently shared across every concurrent pi-web session in the same
 *   container process).
 * - Every CHECK_EVERY_N_CALLS-th tool call, ask the judge model whether
 *   the newest call looks like a semantic repeat of an earlier one in the
 *   window. Gated on call count (not wall-clock time) because the judge
 *   call has real latency against a single-slot server - checking every
 *   call would both slow down normal work and risk queueing contention
 *   with other judge traffic (litellm's `judge` role).
 *
 *   Originally also gated on a 2-minute "burst window" (skip the check
 *   if the last 5 calls were too spread out in time) - removed after real
 *   testing showed it was actively harmful: a live test with completely
 *   normal pacing (~33s between calls, not even unusually slow) had the
 *   5-call window span 163s, over the 2-minute threshold, and the check
 *   was silently skipped entirely - missing the exact repeat it exists to
 *   catch. The gate's original justification (avoid false-firing on
 *   genuinely unrelated spread-out work) turned out to be redundant: the
 *   judge already does this correctly on its own (confirmed twice in real
 *   testing - it answered "no" when the newest call in a window spanning
 *   many minutes of unrelated prior activity genuinely wasn't a repeat).
 *   A time-based gate only added a way to silently disable detection for
 *   any realistically-paced session, which is most of them.
 *
 *   Found via real live testing (not assumed): this judge model
 *   (GLM-4.7-Flash) does chain-of-thought reasoning before answering.
 *   Tried disabling that via `chat_template_kwargs: {enable_thinking:
 *   false}` for speed (0.4s response) - it got the verdict WRONG on a
 *   real test case (missed that `rocm-smi --showuse` and `cat
 *   .../gpu_busy_percent` check the same underlying fact). With
 *   reasoning enabled and enough token budget, it correctly answered
 *   `VERDICT: yes, EARLIER_CALL: 1` on the same case - ~7-8s and ~500-700
 *   completion tokens. Since correctness on exactly this kind of case is
 *   the whole reason this extension exists over pi-loop-police's free-
 *   but-shallow Jaccard matching, reasoning stays ON and MAX_TOKENS is
 *   budgeted generously - a slow correct check beats a fast wrong one.
 *
 *   Second real bug found via testing, more fundamental: calling the
 *   judge via `complete()` (the "textbook" API from
 *   @earendil-works/pi-ai/compat, used exactly per the bundled
 *   custom-compaction.ts example) silently breaks the OUTER tool_call
 *   block mechanism - confirmed via a controlled diagnostic (an
 *   unconditional `{block: true}` returned immediately after a real
 *   `complete()` call still let the tool execute unblocked, while the
 *   identical unconditional block after a plain `setTimeout` of the same
 *   duration worked correctly, and after a raw `fetch()` of the same
 *   duration also worked correctly). Root cause not fully traced into
 *   pi-agent-core's internals, but the leading theory: `complete()`
 *   fires its own nested before_provider_request/after_provider_response
 *   extension hooks, and that reentrant dispatch into the same extension
 *   runner - while already inside a tool_call handler - corrupts the
 *   outer block decision. Worked around by calling litellm's OpenAI-
 *   compatible endpoint directly via `fetch()` instead of `complete()`
 *   for this specific side-channel call - confirmed working end-to-end
 *   afterward. `complete()` remains correct and necessary for its
 *   documented use case (e.g. custom-compaction's own summarization
 *   call, which isn't inside a tool_call handler) - this is a narrow,
 *   confirmed incompatibility with calling it FROM a tool_call handler
 *   specifically, not a blanket problem with the function.
 * - On a positive verdict: block the call synchronously with a
 *   corrective `reason`. Verified working end-to-end after the fetch()
 *   fix (see decision log for the real test transcript).
 */

import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";

const JUDGE_PROVIDER = "local-litellm";
const JUDGE_MODEL_ID = "judge";
const WINDOW_SIZE = 8;
const CHECK_EVERY_N_CALLS = 5;
// Reasoning models need real headroom to finish their chain-of-thought
// before they ever reach the actual answer - measured live, 200 tokens
// was nowhere near enough (truncated mid-reasoning, empty content field,
// finish_reason "length"). 1500 covers real observed usage (~530-720
// total tokens) with margin.
const JUDGE_MAX_TOKENS = 1500;
const LOG_PREFIX = "[semantic-repeat-guard]";

interface ToolCallRecord {
	toolName: string;
	input: unknown;
	timestamp: number;
}

interface SessionState {
	window: ToolCallRecord[];
	callCount: number;
}

// Keyed by real session id (see module docstring above) - not a bare
// module-level singleton.
const sessionStates = new Map<string, SessionState>();

function getState(sessionId: string): SessionState {
	let state = sessionStates.get(sessionId);
	if (!state) {
		state = { window: [], callCount: 0 };
		sessionStates.set(sessionId, state);
	}
	return state;
}

function summarizeCall(record: ToolCallRecord, index: number): string {
	const argsStr = JSON.stringify(record.input);
	const truncated = argsStr.length > 300 ? `${argsStr.slice(0, 300)}...(truncated)` : argsStr;
	return `${index + 1}. ${record.toolName}(${truncated})`;
}

interface JudgeVerdict {
	isRepeat: boolean;
	explanation: string;
}

async function askJudge(ctx: ExtensionContext, window: ToolCallRecord[]): Promise<JudgeVerdict | null> {
	const model = ctx.modelRegistry.find(JUDGE_PROVIDER, JUDGE_MODEL_ID);
	if (!model) {
		console.error(`${LOG_PREFIX} judge model ${JUDGE_PROVIDER}/${JUDGE_MODEL_ID} not found in registry - skipping check`);
		return null;
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		console.error(`${LOG_PREFIX} could not resolve judge auth - skipping check`);
		return null;
	}

	const callList = window.map(summarizeCall).join("\n");
	const prompt = `You are watching a coding agent's recent tool calls for signs it is stuck re-doing the same underlying thing with different wording or arguments - NOT byte-identical repeats (those are already caught elsewhere), but the SAME underlying question or goal attempted a different way.

Recent tool calls, oldest first:
${callList}

Does the LAST call (#${window.length}) look like a semantic repeat of an earlier one in this list - same underlying goal/question, just phrased or invoked differently? Answer in exactly this format:
VERDICT: yes|no
EARLIER_CALL: <number, or "none">
WHY: <one short sentence>`;

	try {
		// Deliberately raw fetch, not complete() - see module docstring for
		// the confirmed reason (complete() breaks the outer tool_call block
		// mechanism when called from inside a tool_call handler).
		//
		// Explicit timeout (found via real testing, not theoretical): a
		// window containing ambiguous entries (e.g. a bare `sleep 40` call)
		// can push the judge's reasoning well past what JUDGE_MAX_TOKENS
		// covers, taking 20+ real seconds and still not finishing
		// (finish_reason "length" again, same failure mode as the
		// insufficient-token-budget bug, just triggered by different window
		// content). That's already handled safely on the content side (no
        // text -> no verdict -> no block, fails open) - but the fetch()
		// call itself had no ceiling, so a genuinely stuck/contended judge
		// server could stall the whole tool_call indefinitely. 30s is
		// generous over the ~7-8s typical case while still bounding the
		// worst case.
		const timeoutSignal = AbortSignal.timeout(30_000);
		const res = await fetch(`${model.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${auth.apiKey}`,
				...(auth.headers ?? {}),
			},
			body: JSON.stringify({
				model: JUDGE_MODEL_ID,
				max_tokens: JUDGE_MAX_TOKENS,
				messages: [{ role: "user", content: prompt }],
			}),
			signal: timeoutSignal,
		});
		if (!res.ok) {
			console.error(`${LOG_PREFIX} judge call returned HTTP ${res.status}`);
			return null;
		}
		const data = (await res.json()) as { choices: { message: { content: string } }[] };
		const text = data.choices[0]?.message?.content ?? "";
		if (!text.trim()) {
			console.error(`${LOG_PREFIX} judge returned empty content - skipping check`);
			return null;
		}

		const isRepeat = /VERDICT:\s*yes/i.test(text);
		return { isRepeat, explanation: text.trim() };
	} catch (err) {
		console.error(`${LOG_PREFIX} judge call failed:`, err);
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const state = getState(sessionId);

		const record: ToolCallRecord = {
			toolName: event.toolName,
			input: event.input,
			timestamp: Date.now(),
		};
		state.window.push(record);
		if (state.window.length > WINDOW_SIZE) {
			state.window.shift();
		}
		state.callCount += 1;

		if (state.callCount % CHECK_EVERY_N_CALLS !== 0) {
			return;
		}
		if (state.window.length < CHECK_EVERY_N_CALLS) {
			return;
		}

		console.log(`${LOG_PREFIX} session ${sessionId.slice(0, 8)}: checking window of ${state.window.length} calls with judge`);
		const verdict = await askJudge(ctx, state.window);
		if (!verdict) {
			return;
		}

		console.log(`${LOG_PREFIX} session ${sessionId.slice(0, 8)}: judge verdict - ${verdict.explanation.replace(/\n/g, " | ")}`);

		if (verdict.isRepeat) {
			const reason = `This looks like a semantic repeat of an earlier tool call in this session (same underlying goal, different wording/arguments). ${verdict.explanation} Stop and either report what you already know, or explain why this call is genuinely different before retrying.`;
			return { block: true, reason };
		}
	});

	pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
		sessionStates.delete(ctx.sessionManager.getSessionId());
	});
}
