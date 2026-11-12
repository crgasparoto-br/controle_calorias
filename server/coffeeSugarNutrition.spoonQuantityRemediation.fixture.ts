/**
 * A-1339-NEW-03: literal independent-audit controls and metamorphic siblings.
 * Keep this test-only oracle separate from the parser implementation so
 * regressions cannot pass by copying the rule being validated.
 */
export const A1339_NEW03_AUDIT_NEGATIVE = [
  ["N-01", "café com 1 colher de chá de açúcar e 2 colherzinhas"],
  ["N-02", "café com 1 colher de chá de açúcar e duas gotinhas"],
  ["N-03", "café com 1 colher de chá de açúcar e meia colherzinha"],
  ["N-04", "café com 1 colher de chá de açúcar e 3 pitadinhas"],
  ["N-05", "café com 1 colher de chá de açúcar e dois tiquinhos"],
  ["N-06", "café com 1 colher de chá de açúcar e 1 gotinha"],
  ["N-07", "café com 1 colher de chá de açúcar e 2 bocadinhos"],
  ["N-08", "café com 1 colher de chá de açúcar e duas colherzinhas"],
  ["N-09", "café com 1 colher de chá de açúcar e mais uma colherzinha"],
  ["N-10", "café com 1 colher de chá de açúcar e mais um tiquinho"],
  ["N-11", "café com 1 colher de chá de açúcar e 2 colherzinhas de açúcar"],
  ["N-12", "café com 1 colher de chá de açúcar e duas gotinhas de açúcar"],
  ["N-13", "café com 1 colher de chá de açúcar e mais 2 gotinhas"],
  ["N-14", "café com 1 colher de chá de açúcar e umas gotinhas"],
  ["N-15", "café com 1 colher de chá de açúcar e algumas colherzinhas"],
  ["N-16", "café com 1 colher de chá de açúcar e meia gotinha"],
  ["N-17", "café com 1 colher de chá de açúcar e mais duas colherzinhas"],
  ["N-18", "café com 1 colher de chá de açúcar e 3 colherzinhas"],
] as const;

export const A1339_NEW03_AUDIT_POSITIVE = [
  ["P-01", "café com 1 colher de chá de açúcar e 2 colherzinhas de leite"],
  ["P-02", "café com 1 colher de chá de açúcar e duas gotinhas do leite"],
  ["P-03", "café com 1 colher de chá de açúcar e meia colherzinha de leite"],
  ["P-04", "café com 1 colher de chá de açúcar e 3 pitadinhas de mel"],
  ["P-05", "café com 1 colher de chá de açúcar e 2 g do leite"],
  ["P-06", "café com 1 colher de chá de açúcar e mais uma colherzinha do leite"],
  ["P-07", "café com 1 colher de chá de açúcar e 1 pão"],
  ["P-08", "café com 1 colher de chá de açúcar"],
  ["P-09", "café com 1 colher de chá de açúcar e mais duas colherzinhas de leite"],
  ["P-10", "café com 1 colher de chá de açúcar e 1 gotinha de leite"],
  ["P-11", "café com 1 colher de chá de açúcar e 2 bocadinhos de leite"],
  ["P-12", "café com 1 colher de chá de açúcar e umas gotinhas de leite"],
] as const;

export const A1339_NEW03_METAMORPHIC_NEGATIVE = [
  ["MN-01", "café com 1 colher de chá de açúcar e 2 gotinhas"],
  ["MN-02", "café com 1 colher de chá de açúcar e duas gotinhas"],
  ["MN-03", "café com 1 colher de chá de açúcar e +2 gotinhas"],
  ["MN-04", "café com 1 colher de chá de açúcar e meia gotinha"],
  ["MN-05", "café com 1 colher de chá de açúcar e ½ gotinha"],
  ["MN-06", "café com 1 colher de chá de açúcar e 0,5 gotinha"],
  ["MN-07", "café com 1 colher de chá de açúcar e umas gotinhas"],
  ["MN-08", "café com 1 colher de chá de açúcar e algumas colherzinhas"],
  ["MN-09", "café com 1 colher de chá de açúcar e mais duas colherzinhas"],
  ["MN-10", "café com 1 colher de chá de açúcar , 2 gotinhas"],
  ["MN-11", "café com 1 colher de chá de açúcar ; 2 gotinhas"],
  ["MN-12", "café com 1 colher de chá de açúcar . 2 gotinhas"],
  ["MN-13", "café com 1 colher de chá de açúcar 2 gotinhas"],
  ["MN-14", "café com 1 colher de chá de açúcar e 2 gotinhas extras"],
  ["MN-15", "café com 1 colher de chá de açúcar e duas gotinhas adicionais"],
  ["MN-16", "café com 1 colher de chá de açúcar e outras gotinhas"],
  ["MN-17", "café com 1 colher de chá de açúcar e mais outras duas gotinhas"],
  ["MN-18", "café com 1 colher de chá de açúcar e uma outra gotinha"],
  ["MN-19", "café com 1 colher de chá de açúcar e duas outras gotinhas"],
  ["MN-20", "café com 1 colher de chá de açúcar e 2 colherzinhas do açúcar"],
  ["MN-21", "café com 1 colher de chá de açúcar e 2 gotinhas e leite"],
  ["MN-22", "café com 1 colher de chá de açúcar e duas gotinhas do açúcar"],
  ["MN-23", "café com 1 colher de chá de açúcar e leite com duas gotinhas e mais duas"],
  ["MN-24", "café com 1 colher de chá de açúcar e 1 pitadinha ou 2"],
  ["MN-25", "café com 1 colher de chá de açúcar e duas pitadinhas a mais"],
  ["MN-26", "café com 1 colher de chá de açúcar e dois tiquinhos"],
  ["MN-27", "café com 1 colher de chá de açúcar e mais 1/2 bocadinho"],
  ["MN-28", "café com 1 colher de chá de açúcar e 1/2 colherzinha"],
  ["MN-29", "café com 1 colher de chá de açúcar e só algumas gotinhas"],
  ["MN-30", "café com 1 colher de chá de açúcar e 1 punhadinho"],
  ["MN-31", "café com 1 colher de chá de açúcar e três copinhos"],
  ["MN-32", "café com 1 colher de chá de açúcar e poucas gotinhas"],
  ["MN-33", "café com 1 colher de chá de açúcar e duas colherzinhas adicionais"],
  ["MN-34", "café com 1 colher de chá de açúcar e duas gotinhas extras"],
] as const;

export const A1339_NEW03_METAMORPHIC_POSITIVE = [
  ["MP-01", "café com 1 colher de chá de açúcar e 2 gotinhas de leite"],
  ["MP-02", "café com 1 colher de chá de açúcar e duas gotinhas da bebida vegetal"],
  ["MP-03", "café com 1 colher de chá de açúcar e meia gotinha do leite"],
  ["MP-04", "café com 1 colher de chá de açúcar e ½ gotinha de leite"],
  ["MP-05", "café com 1 colher de chá de açúcar e mais duas colherzinhas do leite"],
  ["MP-06", "café com 1 colher de chá de açúcar e outras duas gotinhas de leite"],
  ["MP-07", "café com 1 colher de chá de açúcar e mais outras duas gotinhas de leite"],
  ["MP-08", "café com 1 colher de chá de açúcar e leite com duas gotinhas"],
  ["MP-09", "café com 1 colher de chá de açúcar e leite com mais duas gotinhas"],
  ["MP-10", "café com 1 colher de chá de açúcar e duas coxinhas"],
  ["MP-11", "café com 1 colher de chá de açúcar e uma coxinha"],
  ["MP-12", "café com 1 colher de chá de açúcar e três coxinhas"],
  ["MP-13", "café com 1 colher de chá de açúcar e dois pãezinhos"],
  ["MP-14", "café com 1 colher de chá de açúcar e duas balinhas"],
  ["MP-15", "café com 1 colher de chá de açúcar e meia banana"],
  ["MP-16", "café com 1 colher de chá de açúcar e mais dois docinhos"],
  ["MP-17", "café com 1 colher de chá de açúcar e outras duas gotinhas do leite"],
  ["MP-18", "café com 1 colher de chá de açúcar e 2 bocadinhos de mel"],
  ["MP-19", "café com 1 colher de chá de açúcar e mais dois copinhos de leite"],
  ["MP-20", "café com 1 colher de chá de açúcar e duas gotinhas adicionais de leite"],
  ["MP-21", "café com 1 colher de chá de açúcar e duas colherzinhas extras de leite"],
  ["MP-22", "café com 1 colher de chá de açúcar e duas porções adicionais de leite"],
  ["MP-23", "café com 1 colher de chá de açúcar e duas porções extras de leite"],
] as const;

/** A-133905: unmeasured repetition must not disappear after one sugar spoon. */
export const A1339_133905_NEGATIVE = [
  ["REP-01", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e a\u00e7\u00facar"],
  ["REP-02", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e a\u00e7\u00facar mascavo"],
  ["REP-03", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e a\u00e7\u00facar cristal"],
  ["REP-04", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e a\u00e7\u00facar branco"],
  ["REP-05", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar ou a\u00e7\u00facar"],
  ["REP-06", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar, a\u00e7\u00facar"],
  ["REP-07", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar. a\u00e7\u00facar mascavo"],
  ["REP-08", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar a\u00e7\u00facar"],
  ["REP-09", "caf\u00e9 com a\u00e7\u00facar e uma colher de ch\u00e1 de a\u00e7\u00facar"],
  ["REP-10", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e leite e a\u00e7\u00facar"],
  ["REP-11", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e o a\u00e7\u00facar mascavo"],
  ["REP-12", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e depois a\u00e7\u00facar"],
  ["REP-13", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e por fim a\u00e7\u00facar"],
  ["REP-14", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e em seguida a\u00e7\u00facar mascavo"],
  ["REP-15", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar, depois a\u00e7\u00facar"],
  ["REP-16", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e eventualmente a\u00e7\u00facar"],
  ["REP-17", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e s\u00f3 agora a\u00e7\u00facar"],
  ["REP-18", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e, depois, a\u00e7\u00facar"],
  ["REP-19", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e gotas de a\u00e7\u00facar"],
  ["REP-20", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e pitadas de a\u00e7\u00facar"],
  ["REP-21", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e colheradas de a\u00e7\u00facar"],
  ["REP-22", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e por\u00e7\u00e3o de a\u00e7\u00facar"],
  ["REP-23", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e pouco de a\u00e7\u00facar"],
  ["REP-24", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e um saco de a\u00e7\u00facar"],
  ["REP-25", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e restinho de a\u00e7\u00facar"],
  ["REP-26", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e pontinha de a\u00e7\u00facar"],
  ["REP-27", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e toque de a\u00e7\u00facar"],
  ["REP-28", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e punhado de a\u00e7\u00facar"],
  ["REP-29", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e mais gotas de a\u00e7\u00facar"],
  ["REP-30", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e gotas extras de a\u00e7\u00facar"],
  ["REP-31", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar, gotas de a\u00e7\u00facar"],
  ["REP-32", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar; pitadas de a\u00e7\u00facar"],
  ["REP-33", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e por\u00e7\u00f5es adicionais de a\u00e7\u00facar"],
  ["REP-34", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e quantidade de a\u00e7\u00facar"],
  ["REP-35", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar depois gotas de a\u00e7\u00facar"],
  ["REP-36", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e bocado de a\u00e7\u00facar"],
  ["REP-37", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e pacote de a\u00e7\u00facar"],
  ["REP-38", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e meia colherada de a\u00e7\u00facar"],
  ["REP-39", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e adicional de a\u00e7\u00facar"],
  ["REP-40", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e logo com gotas de a\u00e7\u00facar"],
  ["REP-41", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e, por outro lado, com gotas de a\u00e7\u00facar"],
  ["REP-42", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e resto de a\u00e7\u00facar"],
  ["REP-43", "caf\u00e9 com gotas de a\u00e7\u00facar e uma colher de ch\u00e1 de a\u00e7\u00facar"],
] as const;

export const A1339_133905_POSITIVE = [
  ["SEP-01", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar"],
  ["SEP-02", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e leite"],
  ["SEP-03", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e bolo de a\u00e7\u00facar"],
  ["SEP-04", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e duas por\u00e7\u00f5es adicionais de leite"],
  ["SEP-05", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e 1 p\u00e3o"],
  ["SEP-06", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e mais um pouco de leite"],
  ["SEP-07", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e torta de a\u00e7\u00facar"],
  ["SEP-08", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e bolo com cobertura de a\u00e7\u00facar"],
  ["SEP-09", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e pudim de a\u00e7\u00facar"],
  ["SEP-10", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e bolo com calda de a\u00e7\u00facar"],
  ["SEP-11", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e doce de a\u00e7\u00facar"],
  ["SEP-12", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e uma banana"],
  ["SEP-13", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e bolo com gotas de a\u00e7\u00facar"],
  ["SEP-14", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e pudim com pitadas de a\u00e7\u00facar"],
  ["SEP-15", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e torta com cobertura extra de a\u00e7\u00facar"],
  ["SEP-16", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e um bolo com gotas de a\u00e7\u00facar"],
  ["SEP-17", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e 2 tortas de a\u00e7\u00facar"],
  ["SEP-18", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e 2 bolos recheados de a\u00e7\u00facar"],
  ["SEP-19", "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar e 2 bolos bem recheados de a\u00e7\u00facar"],
] as const;


/** A-133906: a concurrent measure of the same ingredient must never be lost. */
export const A1339_133906_NEGATIVE = [
  ["UQ-01", "café com uma colher de chá de açúcar e 2 cubos de açúcar"],
  ["UQ-02", "café com uma colher de chá de açúcar e meio cubo de açúcar"],
  ["UQ-03", "café com uma colher de chá de açúcar e 2 unidades de açúcar"],
  ["UQ-04", "café com uma colher de chá de açúcar e uma colher de café de açúcar"],
  ["UQ-05", "café com uma colher de chá de açúcar e 2 cubinhos de açúcar"],
  ["UQ-06", "café com uma colher de chá de açúcar e um torrão de açúcar"],
  ["UQ-07", "café com uma colher de chá de açúcar e 2 pedaços de açúcar"],
  ["UQ-08", "café com uma colher de chá de açúcar e duas medidas de açúcar"],
  ["UQ-09", "café com 2 cubos de açúcar e uma colher de chá de açúcar"],
  ["UQ-10", "café com uma colher de chá de açúcar e mais 2 cubos de açúcar"],
  ["UQ-11", "café com uma colher de chá de açúcar; 2 cubos de açúcar"],
  ["UQ-12", "café com uma colher de chá de açúcar e meia unidade de açúcar"],
  ["UQ-13", "café com uma colher de chá de açúcar e uma colher de café do açúcar"],
] as const;

/** A-133906: explicitly different ingredients and named foods are not sugar doses. */
export const A1339_133906_POSITIVE = [
  ["UP-01", "café com uma colher de chá de açúcar"],
  ["UP-02", "café com uma colher de chá de açúcar e 5 g de leite"],
  ["UP-03", "café com uma colher de chá de açúcar e 2 cubos de gelo"],
  ["UP-04", "café com uma colher de chá de açúcar e 2 unidades de pão"],
  ["UP-05", "café com uma colher de chá de açúcar e uma colher de café de leite"],
  ["UP-06", "café com uma colher de chá de açúcar e 2 tortas de açúcar"],
  ["UP-07", "café com uma colher de chá de açúcar e 2 bolos recheados de açúcar"],
  ["UP-08", "café com uma colher de chá de açúcar e 2 bolos bem recheados de açúcar"],
  ["UP-09", "café com uma colher de chá de açúcar e um pudim com cubinhos de açúcar"],
] as const;

/** A-133907: spoon denominations without an ingredient are not food bindings. */
export const A1339_133907_NEGATIVE = [
  ["DS-01", "café com uma colher de chá de açúcar e uma colher de café"],
  ["DS-02", "café com uma colher de chá de açúcar e mais uma colher de café"],
  ["DS-03", "café com uma colher de chá de açúcar e duas colheres de café"],
  ["DS-04", "café com uma colher de chá de açúcar e uma colher de sobremesa"],
  ["DS-05", "café com uma colher de chá de açúcar e meia colher de café"],
  ["DS-06", "café com uma colher de chá de açúcar e uma colherzinha de café"],
  ["DS-07", "café com uma colher de chá de açúcar e mais uma colherzinha de sobremesa"],
  ["DS-08", "café com uma colher de chá de açúcar e uma colher de café cheia de açúcar"],
  ["DS-09", "café com uma colher de chá de açúcar e uma colher de café bem cheia de açúcar"],
  ["DS-10", "café com uma colher de chá de açúcar e uma colher de sobremesa do açúcar"],
] as const;

/** A-133907: independent measures and explicitly bound ingredients remain valid. */
export const A1339_133907_POSITIVE = [
  ["DP-01", "café com uma colher de chá de açúcar e uma colher de café de leite"],
  ["DP-02", "café com uma colher de chá de açúcar e uma colher de sobremesa de leite"],
  ["DP-03", "café com uma colher de chá de açúcar e uma colherzinha de café de leite"],
  ["DP-04", "café com uma colher de chá de açúcar e uma colher de café cheia de leite"],
  ["DP-05", "café com uma colher de chá de açúcar e uma colher de café bem cheia de leite"],
  ["DP-06", "café com uma colher de chá de açúcar e uma colher de geleia"],
  ["DP-07", "café com uma colher de chá de açúcar e 2 cubos de gelo"],
  ["DP-08", "café com uma colher de chá de açúcar e 2 bolos recheados de açúcar"],
  ["DP-09", "café com uma colher de chá de açúcar e uma colher de sopa de leite"],
] as const;

/** A-133908: second unverified packaged sugar quantities require clarification. */
export const A1339_133908_NEGATIVE = [
  ["N8-01", "café com uma colher de chá de açúcar e dois saquinhos de açúcar"],
  ["N8-02", "café com uma colher de chá de açúcar e 2 saquinhos de açúcar"],
  ["N8-03", "café com uma colher de chá de açúcar e 2 tabletes de açúcar"],
  ["N8-04", "café com uma colher de chá de açúcar e 2 pedrinhas de açúcar"],
  ["N8-05", "café com uma colher de chá de açúcar e mais alguns saquinhos de açúcar"],
  ["N8-06", "café com uma colher de chá de açúcar e mais cubos"],
  ["N8-07", "café com uma colher de chá de açúcar e mais cubinhos"],
  ["N8-08", "café com uma colher de chá de açúcar e mais uma caneca de açúcar"],
  ["N8-09", "café com uma colher de chá de açúcar e duas tampinhas de açúcar"],
  ["N8-10", "café com uma colher de chá de açúcar e um potinho de açúcar"],
  ["N8-11", "café com uma colher de chá de açúcar e mais meia caneca de açúcar"],
  ["N8-12", "café com uma colher de chá de açúcar e 3 canecas de açúcar"],
  ["N8-13", "café com uma colher de chá de açúcar e mais duas tampinhas de açúcar"],
  ["N8-14", "café com uma colher de chá de açúcar e 2 bisnagas de açúcar"],
  ["N8-15", "café com uma colher de chá de açúcar e uma embalagemzinha de açúcar"],
  ["N8-16", "café com uma colher de chá de açúcar e 2 envelopes de açúcar"],
  ["N8-17", "café com uma colher de chá de açúcar e mais 2 envelopes de açúcar"],
  ["N8-18", "café com uma colher de chá de açúcar e três potinhos de açúcar"],
  ["N8-19", "café com uma colher de chá de açúcar e 2 saquinhos do açúcar"],
  ["N8-20", "café com uma colher de chá de açúcar e um bolo com açúcar e 2 saquinhos de açúcar"],
  ["N8-21", "café com uma colher de chá de açúcar e 2 envelopes com açúcar"],
  ["N8-22", "café com uma colher de chá de açúcar e mais cubinhos de açúcar"],
  ["N8-23", "café com uma colher de chá de açúcar e 2 potes de açúcar"],
  ["N8-24", "café com uma colher de chá de açúcar e 2 sacos de açúcar"],
  ["N8-25", "café com uma colher de chá de açúcar e 2 caixinhas de açúcar"],
  ["N8-26", "café com uma colher de chá de açúcar e mais uma embalagem de açúcar"],
] as const;

/** A-133909: a distinct food accompanied by sugar is not a second coffee dose. */
export const A1339_133909_POSITIVE = [
  ["P9-01", "café com uma colher de chá de açúcar e um bolo com açúcar"],
  ["P9-02", "café com uma colher de chá de açúcar e 2 bolos com açúcar"],
  ["P9-03", "café com uma colher de chá de açúcar e 2 ovos com açúcar"],
  ["P9-04", "café com uma colher de chá de açúcar e um bolo recheado com açúcar"],
  ["P9-05", "café com uma colher de chá de açúcar e 2 pães com açúcar"],
  ["P9-06", "café com uma colher de chá de açúcar e uma banana com açúcar"],
  ["P9-07", "café com uma colher de chá de açúcar e 2 tortas com açúcar"],
  ["P9-08", "café com uma colher de chá de açúcar e um pudim com açúcar"],
  ["P9-09", "café com uma colher de chá de açúcar e 2 saquinhos de leite"],
  ["P9-10", "café com uma colher de chá de açúcar e mais 2 bolos com açúcar"],
  ["P9-11", "café com uma colher de chá de açúcar e um pudim com açúcar e uma banana"],
  ["P9-12", "café com uma colher de chá de açúcar e 2 cubinhos de gelo"],
  ["P9-13", "café com uma colher de chá de açúcar e um bolo com mais açúcar"],
  ["P9-14", "café com uma colher de chá de açúcar e uma fatia de bolo com açúcar"],
  ["P9-15", "café com uma colher de chá de açúcar e duas fatias de pudim com açúcar"],
  ["P9-16", "café com uma colher de chá de açúcar e 2 potes de leite"],
  ["P9-17", "café com uma colher de chá de açúcar e 3 caixinhas de leite"],
] as const;


/** A-133911: a competing amount bound to the same sugar cannot vanish because
 * its utensil lacks a certified gram conversion. These are syntax-only cases. */
const A1339_INDEPENDENT_AUDIT_BASE = "caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar";
export const A1339_133911_NEGATIVE = ([
  ["S11-01", "duas pazinhas de a\u00e7\u00facar"],
  ["S11-02", "duas conchas de a\u00e7\u00facar"],
  ["S11-03", "um scoop de a\u00e7\u00facar"],
  ["S11-04", "uma tampa de a\u00e7\u00facar"],
  ["S11-05", "tr\u00eas pazinhas do a\u00e7\u00facar"],
  ["S11-06", "mais uma concha de a\u00e7\u00facar"],
  ["S11-07", "2 scoops de a\u00e7\u00facar"],
  ["S11-08", "outra tampa de a\u00e7\u00facar"],
  ["S11-09", "conchas de a\u00e7\u00facar"],
  ["S11-10", "um bolo com a\u00e7\u00facar e uma tampa de a\u00e7\u00facar"],
  ["S11-11", "mais 2 conchinhas de a\u00e7\u00facar"],
  ["S11-12", "2 p\u00e1s de a\u00e7\u00facar"],
  ["S12-N1", "um brigadeiro de colher e mais uma colher"],
  ["S12-N2", "um brigadeiro de colher e duas colheres de a\u00e7\u00facar"],
  ["S12-N3", "uma colher de sobremesa"],
] as const).map(([id, ending]) => [id, A1339_INDEPENDENT_AUDIT_BASE + " e " + ending] as const);

/** A-133912: "de colher" is part of another food's name, not a count of
 * tablespoons. Binding remains based on syntax, not hardcoded food names. */
export const A1339_133912_POSITIVE = ([
  ["S12-01", "um brigadeiro de colher"],
  ["S12-02", "um pudim de colher"],
  ["S12-03", "dois brigadeiros de colher"],
  ["S12-04", "um bolo de colher"],
  ["S12-05", "um doce de colher"],
  ["S12-06", "2 brigadeiros de colher e leite"],
  ["S12-07", "uma colher de sopa de leite e um brigadeiro de colher"],
  ["S11-P1", "2 conchas de leite"],
  ["S11-P2", "duas pazinhas de leite"],
  ["S11-P3", "2 scoops de whey"],
  ["S11-P4", "2 tortas de a\u00e7\u00facar"],
  ["S11-P5", "mais uma colher de leite"],
] as const).map(([id, ending]) => [id, A1339_INDEPENDENT_AUDIT_BASE + " e " + ending] as const);


/** A-133913: negation in another food is not a contradiction of the coffee. */
const A133913_COFFEE = "café com uma colher de chá de açúcar";
export const A133913_INDEPENDENT_NEGATION_POSITIVE = [
  ["N13-P01", A133913_COFFEE + " e um bolo sem açúcar"],
  ["N13-P02", A133913_COFFEE + " e um pudim de colher sem açúcar"],
  ["N13-P03", A133913_COFFEE + " e um brigadeiro de colher sem açúcar"],
  ["N13-P04", A133913_COFFEE + " e um iogurte zero açúcar"],
  ["N13-P05", A133913_COFFEE + " e leite sem adição de açúcar"],
  ["N13-P06", A133913_COFFEE + "; um bolo sem açúcar"],
  ["N13-P07", A133913_COFFEE + ", um bolo sem açúcar"],
  ["N13-P08", A133913_COFFEE + " e um suco sem açúcar"],
  ["N13-P09", A133913_COFFEE + " e 2 fatias de bolo sem açúcar"],
  ["N13-P10", A133913_COFFEE + " e um bolo sem açúcar e um iogurte zero açúcar"],
  ["N13-P11", A133913_COFFEE + " e uma fatia de bolo sem açúcar"],
  ["N13-P12", A133913_COFFEE + " e um bolo sem açúcar e 2 g de leite"],
  ["N13-P13", "um bolo sem açúcar e " + A133913_COFFEE],
  ["N13-P14", "um bolo sem açúcar; " + A133913_COFFEE],
  ["N13-P15", "um bolo sem açúcar, " + A133913_COFFEE],
  ["N13-P16", "um pudim zero açúcar e " + A133913_COFFEE],
  ["N13-P17", "um bolo sem adição de açúcar e " + A133913_COFFEE],
] as const;

/** A-133913: no other food owner means clarification before lookup. */
export const A133913_COFFEE_NEGATION_NEGATIVE = [
  ["N13-N01", A133913_COFFEE + " e sem açúcar"],
  ["N13-N02", A133913_COFFEE + "; sem açúcar"],
  ["N13-N03", A133913_COFFEE + ", zero açúcar"],
  ["N13-N04", A133913_COFFEE + " e zero açúcar"],
  ["N13-N05", A133913_COFFEE + " sem açúcar"],
  ["N13-N06", A133913_COFFEE + " e sem adição de açúcar"],
  ["N13-N07", A133913_COFFEE + " e um bolo sem açúcar e mais uma colher de açúcar"],
  ["N13-N08", A133913_COFFEE + " e um bolo sem açúcar e mais açúcar"],
  ["N13-N09", A133913_COFFEE + " e um bolo sem açúcar e zero açúcar"],
  ["N13-N10", A133913_COFFEE + " e um bolo sem açúcar; mais uma colher"],
  ["N13-N11", "café sem açúcar com uma colher de chá de açúcar"],
  ["N13-N12", "café zero açúcar com uma colher de chá de açúcar"],
  ["N13-N13", "café sem açúcar e uma colher de chá de açúcar"],
] as const;

/** A-133914: a quantified sugar spoon has a food owner, not a global meal owner. */
const A133914_MEASURED_COFFEE = "café com uma colher de chá de açúcar";
export const A133914_DISTINCT_FOOD_SUGAR_POSITIVE = [
  ["S14-P01", A133914_MEASURED_COFFEE + " e um pudim com duas colheres de chá de açúcar"],
  ["S14-P02", "um pudim com duas colheres de chá de açúcar e " + A133914_MEASURED_COFFEE],
  ["S14-P03", A133914_MEASURED_COFFEE + " e chá com uma colher de sopa de açúcar"],
  ["S14-P04", A133914_MEASURED_COFFEE + "; um pudim com duas colheres de chá de açúcar"],
  ["S14-P05", A133914_MEASURED_COFFEE + ", um pudim com duas colheres de chá de açúcar"],
  ["S14-P06", "um pudim com duas colheres de chá de açúcar; " + A133914_MEASURED_COFFEE],
  ["S14-P07", A133914_MEASURED_COFFEE + " e duas fatias de bolo com duas colheres de chá de açúcar"],
  ["S14-P08", A133914_MEASURED_COFFEE + " e um brigadeiro de colher com duas colheres de chá de açúcar"],
  ["S14-P09", A133914_MEASURED_COFFEE + " e dois bolos com uma colher de sopa de açúcar"],
  ["S14-P10", A133914_MEASURED_COFFEE + " e um bolo com duas colheres de chá de açúcar e um iogurte sem açúcar"],
  ["S14-P11", "chá com uma colher de sopa de açúcar e " + A133914_MEASURED_COFFEE],
  ["S14-P12", A133914_MEASURED_COFFEE + " e uma banana com uma colher de chá de açúcar"],
] as const;

/** A spoon belonging exclusively to another food is never a coffee spoon. */
export const A133914_OTHER_FOOD_SUGAR_ONLY = [
  ["S14-O01", "café sem açúcar e um pudim com uma colher de chá de açúcar"],
  ["S14-O02", "um pudim com uma colher de chá de açúcar e café sem açúcar"],
  ["S14-O03", "café sem açúcar; um pudim com uma colher de chá de açúcar"],
  ["S14-O04", "café sem açúcar e chá com uma colher de sopa de açúcar"],
  ["S14-O05", "chá com uma colher de sopa de açúcar e café sem açúcar"],
] as const;

/** An independent noun phrase cannot launder a contradiction or unbound dose. */
export const A133914_SUGAR_SCOPE_NEGATIVE = [
  ["S14-N01", "café sem açúcar e uma colher de chá de açúcar"],
  ["S14-N02", A133914_MEASURED_COFFEE + " e duas colheres de sopa de açúcar"],
  ["S14-N03", A133914_MEASURED_COFFEE + " e um bolo sem açúcar e mais uma colher de açúcar"],
  ["S14-N04", A133914_MEASURED_COFFEE + " e um pudim com duas colheres de chá de açúcar e mais uma colher de açúcar"],
  ["S14-N05", A133914_MEASURED_COFFEE + " e um bolo com açúcar e 2 saquinhos de açúcar"],
  ["S14-N06", A133914_MEASURED_COFFEE + " e leite com duas gotinhas e mais duas"],
] as const;
