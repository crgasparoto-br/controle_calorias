# Issue 1158 — Catálogo comercial provisional e governança de rótulos

A implementação da issue 1158 separa **identidade comercial** de **verificação nutricional**. Um alimento comercial só pode seguir para registro automático quando a variante informada for inequívoca e os valores fornecidos pela inferência forem uma estimativa defensável. Nesse caso, o item recebe `resolution.nutritionOrigin = "provisional_estimate"` e `resolution.nutritionVerified = false`. A resposta do WhatsApp informa explicitamente que os nutrientes são provisórios e orienta o usuário a enviar um rótulo legível.

Quando a variante permanece ambígua, quando há alternativas concorrentes ou quando a estimativa é ausente ou fisicamente implausível, o motor continua fail-closed e solicita clarificação. A exceção provisional não reutiliza o catálogo genérico para simular uma marca e não transforma uma estimativa de IA em fonte oficial.

## Evidência de rótulo

Itens com `nutritionOrigin = "nutrition_label"` são persistidos como candidatos globais em `whatsappLearningArtifacts`, com chave determinística de identidade composta por marca, nome canônico, variante e barcode quando disponível. O candidato contém os nutrientes, porção, evidência textual, origem da imagem/OCR, confiança, usuário e refeição de origem. A deduplicação atualiza o candidato existente sem criar uma segunda identidade para o mesmo produto.

O catálogo ativo não é alterado pela entrada do candidato. A administração dispõe de ações separadas para publicar, rejeitar, solicitar uma nova foto e fazer rollback. A publicação grava `dataSource = "nutrition_label"`, atualiza o cache e registra uma auditoria. O rollback marca a entrada global como `deprecated`, remove-a da resolução ativa e registra o motivo da reversão.

## Continuidade WhatsApp

A solicitação de nova foto é gravada como uma pending operation antes do envio outbound. A interação é registrada no registry transversal, pode ser reconstruída após reinício, aceita `CANCELAR` e é reivindicada com versionamento para evitar dupla aplicação. A foto recebida não cria uma nova refeição: se o rótulo for legível, a evidência atualiza o candidato original e retorna à fila de revisão; caso contrário, nenhuma refeição é alterada.

## Persistência e apresentação

A resolução provisional também é incluída no `foodSnapshotJson` do `mealItems`. Consultas de alimentos e respostas de ação reutilizam essa procedência para mostrar o aviso de provisionalidade. Entradas desativadas por rollback são excluídas do cache do catálogo global, mantendo a referência canônica apenas como fallback técnico quando não houver nenhuma entrada ativa persistida.

A administração da fila está disponível na aba **Base de alimentos** da página Admin, com exibição da identidade, porção, macros, evidência, confiança e estado, além das ações governadas do ciclo de vida.
