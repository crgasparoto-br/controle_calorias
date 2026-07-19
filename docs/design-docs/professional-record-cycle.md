# Prontuário e ciclo de acompanhamento profissional

## Escopo

A primeira versão do prontuário profissional reúne avaliação nutricional versionada, anotações privadas, orientações destinadas ao paciente e linha do tempo auditável. Não substitui prontuário médico e não inclui medicamentos, diagnósticos, exames ou documentos clínicos.

## Autorização e isolamento

Toda leitura ou escrita profissional exige autorização `approved` entre o profissional autenticado e o paciente explicitamente selecionado. A autorização é revalidada no backend em cada operação. A revogação impede novas consultas e mutações e a interface remove o paciente selecionado quando a consulta protegida falha.

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

## Regras do acompanhamento

Novas avaliações, anotações e orientações são permitidas apenas durante acompanhamento `active`. Em `paused` ou `ended`, o histórico permanece consultável, mas novas intervenções ficam bloqueadas. A autorização revogada prevalece sobre qualquer estado operacional.

## Paginação e ordenação

Avaliações, anotações, orientações e linha do tempo usam limite explícito e ordenação estável por data, versão e identificador. A primeira leitura não executa cálculos de relatórios nem consultas individuais por item.

## Migração

A migration `0031_professional_record_cycle.sql` cria as tabelas e índices da funcionalidade. Ela deve ser aplicada antes de disponibilizar a nova tela.
