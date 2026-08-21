import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ limitations: [] as Record<string,unknown>[], tail: Promise.resolve() as Promise<unknown> }));
vi.mock("drizzle-orm",()=>({sql:(strings:TemplateStringsArray,...values:unknown[])=>strings.reduce((text,part,index)=>text+part+(index<values.length?String(values[index]??""):""),"")}));
vi.mock("./billingRepositorySupport",()=>({resultRows:(value:unknown)=>value}));
vi.mock("../db",()=>({getDb:vi.fn(async()=>({
  execute:vi.fn(),
  transaction: <T>(callback:(tx:{execute:(query:string)=>Promise<unknown>})=>Promise<T>) => {
    const run=state.tail.then(()=>callback({execute:async query=>{
      if(query.includes("SELECT * FROM billingUsageAbuseCases")) return [{id:"case-1",subjectUserId:99,reviewOutcome:"limitation_approved",systemFailuresExcluded:true,legitimateGrowthReviewed:true,impactJson:{affectedOperations:["ai_heavy_processing"]}}];
      if(query.includes("SELECT * FROM billingUsageLimitations WHERE abuseCaseId")) return state.limitations.map(row=>({...row}));
      if(query.includes("SELECT * FROM billingUsageLimitations WHERE id=")) return state.limitations.slice(0,1);
      if(query.includes("INSERT INTO billingUsageLimitations")) { const extension=query.includes("extension"); state.limitations.push({id:extension?"extension":"initial",abuseCaseId:"case-1",subjectUserId:99,emergencySecurity:false,lifecycleKind:extension?"extension":"initial",startsAt:new Date(extension?"2026-08-24":"2026-08-17"),endsAt:new Date(extension?"2026-08-31":"2026-08-24"),approvedByUserId:extension?11:11,secondApprovedByUserId:extension?22:null,state:"active",revokedAt:null}); return [{affectedRows:1}]; }
      if(query.includes("UPDATE billingUsageLimitations SET state='revoked'")) { const row=state.limitations[0]; if(!row||row.state!=="active") return [{affectedRows:0}]; row.state="revoked"; row.revokedAt=new Date("2026-08-20"); return [{affectedRows:1}]; }
      if(query.includes("SELECT id FROM billingUsageLimitations WHERE abuseCaseId")) return state.limitations.filter((row,index)=>index>0&&row.state==="active");
      return [];
    }}));
    state.tail=run.catch(()=>undefined); return run;
  },
}))}));

const {createLimitation,revokeLimitation}=await import("./usageGovernanceAdminRepository");
const initial={id:"new",abuseCaseId:"case-1",subjectUserId:99,operations:["ai_heavy_processing"],reason:"reviewed",startsAt:new Date("2026-08-17"),endsAt:new Date("2026-08-24"),emergencySecurity:false,approvedByUserId:11,communicatedAt:new Date("2026-08-16"),appealOfferedAt:new Date("2026-08-16")};

describe("usage limitation transactional lifecycle",()=>{
  beforeEach(()=>{state.limitations=[];state.tail=Promise.resolve();});
  it("serializes concurrent create/create so only one initial lifecycle is admitted",async()=>{
    const results=await Promise.allSettled([createLimitation({...initial,id:"a"}),createLimitation({...initial,id:"b",approvedByUserId:22})]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(result=>result.status==="rejected")).toHaveLength(1);
    expect(state.limitations.filter(row=>row.lifecycleKind==="initial")).toHaveLength(1);
  });
  it("serializes revoke before extend and rejects the extension of the revoked initial window",async()=>{
    state.limitations=[{id:"initial",abuseCaseId:"case-1",subjectUserId:99,emergencySecurity:false,lifecycleKind:"initial",startsAt:new Date("2026-08-17"),endsAt:new Date("2026-08-24"),approvedByUserId:11,state:"active",revokedAt:null}];
    const results=await Promise.allSettled([
      revokeLimitation("initial",33,"resolved"),
      createLimitation({...initial,id:"extension",startsAt:new Date("2026-08-24"),endsAt:new Date("2026-08-31"),approvedByUserId:22}),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({status:"rejected",reason:expect.objectContaining({message:"usage_limitation_extension_initial_not_active"})});
    expect(state.limitations).toHaveLength(1);
  });
});
