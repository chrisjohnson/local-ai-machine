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
 * - Every CHECK_EVERY_N_CALLS-th tool call, only if that burst happened
 *   within BURST_WINDOW_MS, ask the judge model whether the newest call
 *   looks like a semantic repeat of an earlier one in the window. Gated
 *   like this because the judge call has real latency against a single-
 *   slot server - checking every call would both slow down normal work
 *   and risk queueing contention with other judge traffic (litellm's
 *   `judge` role).
 *
 *   IMPORTANT, found via real live testing (not assumed): this judge
 *   model (GLM-4.7-Flash) does chain-of-thought reasoning before
 *   answering. Tried disabling that via `chat_template_kwargs:
 *   {enable_thinking: false}` for speed (0.4s response) - it got the
 *   verdict WRONG on a real test case (missed that `rocm-smi --showuse`
 *   and `cat .../gpu_busy_percent` check the same underlying fact).  With
 *   reasoning enabled and enough token budget, it correctly answered
 *   `VERDICT: yes, EARLIER_CALL: 1` on the same case - but took ~7.7s and
 *   ~530 completion tokens. Since correctness on exactly this kind of
 *   case is the whole reason this extension exists over pi-loop-police's
 *   free-but-shallow Jaccard matching, reasoning stays ON and
 *   MAX_TOKENS is budgeted generously - a slow correct check beats a
 *   fast wrong one. The real cost (~8s every 5th call) is an accepted
 *   tradeoff, not an oversight.
 * - On a positive verdict: block the call synchronously with a corrective
 *   `reason`. Blocking is always viable here (the judge call is awaited
 *   inside the tool_call handler before returning), so there's no
 *   scenario in this design where a positive verdict can't be delivered
 *   as a block - a steer fallback specifically for "block wasn't
 *   possible" would be dead code. What CAN fail is the judge call itself
 *   (network/model error) - that's logged and the check is skipped for
 *   this call, not steered, since there's no verdict to act on.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";

const JUDGE_PROVIDER = "local-litellm";
const JUDGE_MODEL_ID = "judge";
const WINDOW_SIZE = 8;
const CHECK_EVERY_N_CALLS = 5;
const BURST_WINDOW_MS = 2 * 60 * 1000;
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
		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user" as const,
						content: [{ type: "text" as const, text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				env: auth.env,
				maxTokens: JUDGE_MAX_TOKENS,
				signal: ctx.signal,
				cacheRetention: "none",
			},
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

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

		const recentBurst = state.window.slice(-CHECK_EVERY_N_CALLS);
		const spanMs = recentBurst[recentBurst.length - 1].timestamp - recentBurst[0].timestamp;
		if (spanMs > BURST_WINDOW_MS) {
			console.log(
				`${LOG_PREFIX} session ${sessionId.slice(0, 8)}: skipping check, last ${CHECK_EVERY_N_CALLS} calls span ${Math.round(spanMs / 1000)}s (over ${BURST_WINDOW_MS / 1000}s burst threshold)`,
			);
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
