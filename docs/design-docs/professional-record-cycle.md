# Prontuário e ciclo de acompanhamento profissional

## Escopo

A primeira versão do prontuário profissional reúne avaliação nutricional versionada, anotações privadas, orientações destinadas ao paciente, atalhos para áreas canônicas e linha do tempo auditável. Não substitui prontuário médico e não inclui medicamentos, diagnósticos, exames ou documentos clínicos.

## Autorização e isolamento

Toda leitura ou escrita profissional exige autorização `approved` entre o profissional autenticado e o paciente explicitamente selecionado. A autorização é revalidada no backend em cada operação e a consulta do prontuário é renovada periodicamente enquanto a tela permanece aberta.

Quando a autorização deixa de ser válida, novas operações são recusadas, consultas em andamento são canceladas, o cache do prontuário e os rascunhos sensíveis são limpos e o contexto retorna à carteira. Nenhum paciente alternativo é selecionado como fallback.

Todas as entidades do prontuário são consultadas pelo `authorizationId` vigente. Isso impede mistura entre autorizações antigas ou vínculos diferentes para o mesmo paciente.

## Avaliação

Cada salvamento cria uma nova versão imutável em `professionalAssessments`. A versão anterior não é sobrescrita. A próxima revisão também atualiza o agendamento operacional do acompanhamento.

Campos da primeira versão:

- objetivo;
- peso e altura;
- rotina e horários;
- atividade física;
- preferências alimentares;
- restrições e alergias;
- dificuldades;
- hábitos relevantes;
- observações profissionais;
- data da avaliação;
- próxima revisão.

## Anotações e orientações

`professionalNotes` contém conteúdo privado do profissional autor. Não existe consulta desse conteúdo na Área do Paciente nem integração com WhatsApp.

`professionalGuidances` contém conteúdo destinado ao paciente. Cada registro possui autor, paciente, versão, visibilidade e estado de entrega. Uma correção cria uma nova versão e pode referenciar a orientação anterior por `supersedesGuidanceId`.

## Máquina de estados

As transições são validadas pelo serviço canônico de acompanhamento:

- `not_started` → `active`: iniciar;
- `active` → `paused`: pausar;
- `paused` → `active`: retomar;
- `active` ou `paused` → `ended`: encerrar.

Cada transição registra ator, data e motivo quando informado. Transições incompatíveis são rejeitadas no backend.

Novas avaliações, anotações, orientações, metas profissionais e alertas dependentes do acompanhamento são permitidos apenas durante estado `active`. Em `paused` ou `ended`, o histórico permanece consultável e as intervenções ficam bloqueadas. A autorização revogada prevalece sobre qualquer estado operacional.

## Proteção de rascunhos

Avaliação, anotação e orientação participam do estado de alterações não salvas. Recarregar ou fechar a página aciona a proteção nativa do navegador. Navegação interna por links ou atalhos solicita confirmação antes de descartar o conteúdo.

Falhas de persistência não limpam os campos. O conteúdo é removido somente depois de confirmação de sucesso ou quando a autorização é revogada.

## Paginação e ordenação

Avaliações, anotações, orientações e linha do tempo usam limite explícito, contagem total e navegação entre páginas. A ordenação é estável por data, versão e identificador. A primeira leitura não executa cálculos de relatórios nem consultas individuais por item.

## Reuso de áreas canônicas

O prontuário oferece atalhos para metas, registros, peso, exercícios e relatórios. Os atalhos abrem as áreas existentes; o prontuário não replica cálculos nutricionais, relatórios ou históricos pessoais.

## Migração

A migration `0031_professional_record_cycle.sql` cria as tabelas e índices da funcionalidade. Ela deve ser aplicada antes de disponibilizar a nova tela.
