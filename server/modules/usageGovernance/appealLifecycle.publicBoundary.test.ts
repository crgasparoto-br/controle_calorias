import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../_core/trpc";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), resolve: vi.fn() }));
vi.mock("./adminService", () => ({
  usageGovernanceAdminService: {
    submitUsageLimitationAppeal: mocks.submit,
    resolveUsageLimitationAppeal: mocks.resolve,
  },
}));

const { usageGovernanceRouter } = await import("./router");
const appRouter = router({ usageGovernance: usageGovernanceRouter });
const user = { id: 41, role: "admin", openId: "u", name: "U", email: "u@example.com", loginMethod: "test", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as any;

async function request(path:string,input:unknown) {
  const app=express(); app.use(express.json());
  app.use("/api/trpc",createExpressMiddleware({router:appRouter,createContext:({req,res})=>({req,res,user})}));
  const server=createServer(app); await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address() as AddressInfo;
  try { return await fetch(`http://127.0.0.1:${address.port}/api/trpc/${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({json:input})}).then(response=>response.json()); }
  finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
}

describe("limitation appeal public lifecycle",()=>{
  beforeEach(()=>vi.clearAllMocks());
  it("submits an appeal with the authenticated subject and persists rationale",async()=>{
    mocks.submit.mockResolvedValue({id:"appeal-1",state:"pending",created:true});
    const body=await request("usageGovernance.submitLimitationAppeal",{limitationId:"11111111-1111-4111-8111-111111111111",rationale:"A causa foi corrigida."});
    expect(body.result.data.json).toMatchObject({state:"pending"});
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({subjectUserId:41,rationale:"A causa foi corrigida."}));
  });
  it.each(["approved","denied"] as const)("reviews and preserves the %s result through the admin boundary",async result=>{
    mocks.resolve.mockResolvedValue({id:"appeal-1",state:"resolved",result,limitationReversed:result==="approved"});
    const body=await request("usageGovernance.reviewLimitationAppeal",{appealId:"22222222-2222-4222-8222-222222222222",result,rationale:`review ${result}`});
    expect(body.result.data.json).toMatchObject({state:"resolved",result,limitationReversed:result==="approved"});
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({reviewerUserId:41,result,rationale:`review ${result}`}));
  });
});
