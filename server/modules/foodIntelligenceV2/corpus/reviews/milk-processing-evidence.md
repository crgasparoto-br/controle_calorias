# Classificacao NOVA: leite simples

Fonte independente: Ministerio da Saude
https://linhasdecuidado.saude.gov.br/portal/obesidade-no-adulto/sou-paciente/processamento-alimentos-profissional/

Leite simples, inclusive apos tratamento UHT, pertence ao grupo in natura ou minimamente processado quando nao sao adicionados ingredientes que alterem a categoria. UHT e atributo de processamento informacional; integral e variante material (ADR Food Intelligence V2 §§8.3/16).

A fixture antiga classificava seis amostras de leite como processed. A revisao muda apenas processingLevel para natural_or_minimally_processed em c-leite-uht-integral, c-qualificador-antes-marca, c-qualificador-depois-marca, c-leite-generico, c-leite-uht-generico e c-leite-integral. O teste milkProcessingClassification.test.ts previne a regressao.

Esta nota nao valida ingredientes do SKU, macros ou desempenho do resolvedor em producao.
