import {describe,expect,it,vi} from "vitest";
import {
 comprehendFoodLanguage, comprehendFoodMaterialLanguage, diagnoseFoodMaterialPendingIncrements,
 diagnoseFoodMaterialMeasuredPrefixPending, type GovernedLexiconEntry, type FoodMaterialLanguageResult,
} from "./linguisticComprehension";
import {parseFoodMaterialObservationBatch, parseFoodObservation} from "./schemas";
type Assert<T extends true> = T;
// The distinct result can't be assigned to the default R3 published surface.
export type PrototypeNotAnOrdinaryResult = Assert<
 Awaited<ReturnType<typeof diagnoseFoodMaterialMeasuredPrefixPending>> extends FoodMaterialLanguageResult ? false : true
>;
const input=(rawText:string,modality:"text"|"audio_transcript"="text")=>({
 rawText, modality, sourceRef:"local:r3:measured-prefix", lexiconRevision:"local-empty", ownerUserId:null,
 locale:"pt-BR" as const,now:new Date("2026-11-26T00:00:00Z"),
 ...(modality==="audio_transcript"?{transcriptionConfidence:0.8}:{}),
});
const range=(raw:string,s:string)=>{const start=raw.indexOf(s);expect(start).toBeGreaterThanOrEqual(0);return {start,end:start+s.length};};
const read=async (raw:string,modality:"text"|"audio_transcript"="text",entries:readonly GovernedLexiconEntry[]=[], ownerUserId:number|null=null)=>{
 const q={...input(raw,modality),ownerUserId}, load=vi.fn(async()=>entries), store={load};
 const result=await diagnoseFoodMaterialMeasuredPrefixPending(q,store);
 expect(load).toHaveBeenCalledTimes(1);
 const ordinary=await comprehendFoodMaterialLanguage(q,store);
 // Compare against both old profiles, not simply a claim about intent.
 const old=await diagnoseFoodMaterialPendingIncrements(q,store);
 const baseline=!old.ok&&old.reason==="unproven-material"
   ? old.affected.map(x=>x.pendingObservation) : null;
 const r2=await comprehendFoodLanguage(q,store);
 expect(r2.every(r=>r.schemaVersion===2&&!("materialClaims" in r))).toBe(true);
 if(result.ok||result.reason!=="unproven-material")throw Error("expected-withheld");
 if(ordinary.ok||ordinary.reason!=="unproven-material")throw Error("expected-default-withheld");
 expect(result.affected.map(({evidenceOnly:_drop,...row})=>row)).toEqual(ordinary.affected);
 expect(result.observations).toEqual(ordinary.observations);
 return {result,ordinary,baseline,q};
};
describe("local-only measured prefix and pending increment",()=>{
 it.each([
 ["café com 1 colher de chá de açúcar e 100 ml de leite com mais um pouco","100 ml de leite","100 ml",100,"ml","leite","mais um pouco","text"],
 ["100 ml de leite com mais um pouco; 2 fatias de manga","100 ml de leite","100 ml",100,"ml","leite","mais um pouco","text"],
 ["22,5 g de polenta com MAIS um tiquinho\n3 fatias de manga","22,5 g de polenta","22,5 g",22.5,"g","polenta","MAIS um tiquinho","audio_transcript"],
 ["80 g de castanha com mais bastante","80 g de castanha","80 g",80,"g","castanha","mais bastante","text"],
 ] as const)("conserva o prefixo sem materializar: %j",async(raw,prefixText,quant,value,unit,name,tailText,modality)=>{
  const {result,ordinary,baseline,q}=await read(raw,modality);
  const at=result.affected.find(row=>row.evidenceOnly)!;
  expect(at).toBeDefined();
  expect(result.diagnosticProfile).toBe("r3-measured-prefix-pending-local-prototype-v2");
  expect(at.surfaceSpan.span).toEqual(range(raw,prefixText+" com "+tailText));
  const proof=at.evidenceOnly!;
  const prefixStart=raw.indexOf(prefixText),tailStart=range(raw,tailText).start;
  expect(proof).toEqual({
    kind:"withheld-lexical-evidence",materializable:false,sourceRef:q.sourceRef,modality,
    lexiconRevision:q.lexiconRevision,clause:at.surfaceSpan.span,
    measuredSurface:{kind:"lexically-attributed-measure",materializable:false,span:range(raw,prefixText),
      nominalSurface:{kind:"literal-not-resolved-identity",
        span:{start:prefixStart+prefixText.lastIndexOf(name),end:prefixStart+prefixText.length},literal:name},
      measure:{span:range(raw,quant),literal:quant,value,unit,literalUnit:unit}},
    pendingSurface:{kind:"indefinite-increment-without-binding",materializable:false,span:range(raw,tailText),
      operator:{span:{start:tailStart,end:tailStart+4},literal:tailText.slice(0,4)},
      owner:null,target:null,amount:null},
  });
  // Detaching all claim-shaped fragments must be rejected, not only the wrapper.
  for(const detached of [proof,proof.measuredSurface,proof.pendingSurface,proof.measuredSurface.measure,proof.measuredSurface.nominalSurface]){
    expect(parseFoodMaterialObservationBatch([detached]).ok).toBe(false);
    expect(parseFoodObservation(detached).ok).toBe(false);
  }
  expect(parseFoodMaterialObservationBatch([...result.observations,proof.measuredSurface]).ok).toBe(false);
  expect(parseFoodMaterialObservationBatch(result.observations).ok).toBe(true);
  expect(ordinary.observations.some(x=>x.identityHints.foodName===name)).toBe(false);
  expect(baseline?.every(x=>x===undefined)).toBe(true);
  if(raw.includes("fatias de manga")){
    expect(result.observations.map(x=>[x.identityHints.foodName,x.quantityHints.value])).toEqual([["manga",raw.includes("22,5")?3:2]]);
  }
  if(raw.startsWith("café")){
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].materialClaims[0]).toMatchObject({kind:"ingredient",amount:{value:1,unit:"colher de chá"}});
  }
 });
 it.each([
  "100 ml de leite com mais 2 ml",
  "100 ml de leite com mais 2 punhados",
  "100 ml de leite com mais 2 pouquinhos",
  "100 ml de leite com mais um pouco de calda",
  "100 ml de leite com mais um pouco.",
  "100 ml de leite com mais um pouco e mais um pouco",
  "entre 100 ml e 120 ml de leite com mais um pouco",
  "100 ml leite com mais um pouco",
  "100 ml de leite integral com mais um pouco",
  "100 ml de leite (com mais um pouco)",
  "100 ml de leite com maiſ um pouco",
  "100 ml de leite com mais um pouco\nDe manga",
  "iogurte e 100 ml de leite com mais um pouco",
  "100 ml de leite com mais um pouco, 2 fatias de manga",
  "100 ml de leite com, mais um pouco",
  "150 ml de nada com mais um pouco",
  "150 ml de não com mais um pouco",
  "150 ml de nenhum com mais um pouco",
  "99999999999999999999 ml de leite com mais um pouco",
  "9007199254740993 ml de leite com mais um pouco",
  "0,1 g de polenta com mais um pouco",
 ] as const)("se abstém sem aumentar escopo: %j",async raw=>{
   const {result}=await read(raw);
   expect(result.affected.every(row=>!row.evidenceOnly)).toBe(true);
 });
 it("não tipa as duas continuações históricas sem medida explícita",async()=>{
  const raw="Café com 1 colher de chá de açúcar e leite com mais um pouco e mais um pouco.";
  const {result}=await read(raw);
  expect(result.affected.map(row=>row.surfaceSpan.span)).toEqual([
   range(raw,"leite com mais um pouco"),range(raw,"mais um pouco."),
  ]);
  expect(result.affected.every(row=>!row.evidenceOnly)).toBe(true);
  expect(result.observations).toHaveLength(1);
  expect(result.observations[0].materialClaims[0]).toMatchObject({kind:"ingredient",amount:{value:1,unit:"colher de chá"}});
 });
 const lex=(kind:GovernedLexiconEntry["kind"],term:string,targetRef:string):GovernedLexiconEntry=>({
   id:9,term,normalizedTerm:term,kind,targetType:"canonical_term",targetRef,
   locale:"pt-BR",scope:"global",userId:null,source:"imported",status:"verified",confidence:1,requiresClarification:false,
   current:true,validFrom:null,validTo:null,
 });
 it.each([
   ["100 ml de medidor com mais um pouco","unit_term","medidor","copo"],
   ["100 ml de leite com mais um tiquinho","alias_surface","tiquinho","polenta"],
   ["100 ml de leite com mais um pouco","alias_surface","leite","laticínio"],
   ["100 ml de leite com mais um pouco","unit_term","ml","g"],
   ["100 ml de leite com mais um pouco","portion_term","pouco","fatia"],
   ["100 ml de leite com mais um tiquinho","alias_surface","um tiquinho","polenta"],
 ] as const)("distingue significado atual de revogado/expirado: %j",async(raw,kind,term,target)=>{
   const global=lex(kind,term,target);
   const personal={...global,scope:"user" as const,userId:17,source:"user_confirmed" as const,status:"active" as const};
   const ordinary=await read(raw);
   const activeGlobal=await read(raw,"text",[global]);
   const activePersonal=await read(raw,"text",[personal],17);
   const revoked=await read(raw,"text",[{...global,status:"revoked"}]);
   const expiry=await read(raw,"text",[{...global,validTo:new Date("2026-11-26T00:00:00Z")}]);
   const wrongTenant=await read(raw,"text",[personal],18);
   expect(ordinary.result.affected.some(row=>row.evidenceOnly)).toBe(true);
   expect(activeGlobal.result.affected.every(row=>!row.evidenceOnly)).toBe(true);
   expect(activePersonal.result.affected.every(row=>!row.evidenceOnly)).toBe(true);
   expect(revoked.result.affected).toEqual(ordinary.result.affected);
   expect(expiry.result.affected).toEqual(ordinary.result.affected);
   expect(wrongTenant.result.affected).toEqual(ordinary.result.affected);
 });
 it.each([
   ["100 ml",100,"ml"],["101 ml",101,"ml"],["100 g",100,"g"],["0,125 g",0.125,"g"],
   ["999999999999 ml",999999999999,"ml"],
 ] as const)("variação material conserva somente o literal exato: %s",async(amt,value,unit)=>{
   const raw=amt+" de leite com mais um pouco";
   const {result}=await read(raw);
   const proof=result.affected[0].evidenceOnly!;
   expect(proof.measuredSurface.measure).toEqual({span:{start:0,end:amt.length},literal:amt,value,unit,literalUnit:unit});
   expect(proof.pendingSurface.amount).toBeNull();
   expect(result.observations).toEqual([]);
 });
});
