import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../aiProvider";
import type { ResolvedCapabilityConfig } from "../configResolver";
import { setAiUsageGate } from "../usageGate";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), finalize: vi.fn() }));
vi.mock("../../../modules/usageGovernance/providerAttemptUsage", () => ({
  prepareAiProviderAttemptUsage: mocks.prepare,
  finalizeAiProviderAttemptUsage: mocks.finalize,
}));

const { executeResolvedCapability } = await import("../capabilityExecutor");

function config(maxAttempts=1):ResolvedCapabilityConfig {
  return { capability:"MEAL_TEXT",state:"ready",primary:{provider:"openai",model:"gpt-test"},timeoutMs:1000,maxAttempts,
    fallback:{requested:false,effectivelyEnabled:false,provider:null,model:null,crossProviderEnabled:false},diagnostics:[],usedLegacyVariables:false };
}

describe("AI attempt accounting durability",()=>{
  afterEach(()=>{setAiUsageGate(null);vi.clearAllMocks();});
  it("persists and claims the attempt before the provider effect, retaining recoverable state when finalization fails",async()=>{
    const order:string[]=[];
    setAiUsageGate(async()=>({correlation:{beneficiaryUserId:41,payerUserId:41}}));
    mocks.prepare.mockImplementation(async input=>{order.push("reserved");return{idempotencyKey:`ai:${input.executionId}:primary:1`,correlationId:input.executionId};});
    mocks.finalize.mockImplementation(async()=>{order.push("finalize-failed");throw new Error("database unavailable after provider response");});
    const provider={id:"openai",createTextResponse:vi.fn(async()=>{order.push("provider");return{outputText:"ok",usage:{inputTokens:2,outputTokens:1}};})} as unknown as AiProvider;
    const result=await executeResolvedCapability(config(),async({provider:adapter,model})=>adapter.createTextResponse({model,input:"safe"}),{
      providerFactories:{openai:()=>provider,"openai-compatible":()=>provider,gemini:()=>provider},
      observability:{origin:"web",flow:"meal_text_extraction",correlation:{userId:41}},
    });
    expect(result.value).toMatchObject({outputText:"ok"});
    expect(order).toEqual(["reserved","provider","finalize-failed"]);
    expect(provider.createTextResponse).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({callRole:"primary",attemptIndex:1}));
  });
});
