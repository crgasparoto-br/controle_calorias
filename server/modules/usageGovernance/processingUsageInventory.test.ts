import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(path,"utf8");

describe("directly measurable processing inventory",()=>{
  it("keeps event producers at storage, traffic and local image processing boundaries",()=>{
    const storage=read("server/storage.ts");
    expect(storage).toContain('operation: "storage_write"');
    expect(storage).toContain('eventState: "provider_dispatch_reserved"');
    expect(storage).toContain("claimUsageProviderDispatch");
    expect(storage).toContain('eventState:"success"');
    expect(read("server/storage.ts")).toContain('operation: "storage_traffic_read"');
    expect(read("server/modules/whatsapp/webhookMediaPipeline.ts")).toContain('operation: "traffic_download"');
    expect(read("server/modules/whatsapp/localMealPhotoOverlay.ts")).toContain('operation: "image_processing"');
  });
  it("documents tested non-applicability for un-attributable and non-transfer entrypoints",()=>{
    const design=read("docs/design-docs/usage-governance.md");
    for(const decision of ["URLs assinadas criadas sem transferir o objeto","CPU geral do monólito","tráfego sem identidade de beneficiário","custos fixos de servidor"]){
      expect(design).toContain(decision);
    }
  });
});
