# Especificação de produto: profissionais

## Objetivo

Permitir que profissionais acompanhem pacientes mediante solicitação, aprovação e histórico auditável de interações.

## Regras de produto

- Acesso profissional exige solicitação e aprovação do paciente.
- A solicitação deve usar o e-mail do paciente como identificador de entrada no fluxo web.
- Profissional só pode ver dashboard, histórico e dados autorizados do paciente.
- Comentários e sugestões de meta devem ser rastreáveis por profissional e paciente.
- Revogação deve bloquear novos acessos imediatamente.

## Critérios de aceite

- Solicitação, aprovação e revogação passam por procedimentos protegidos.
- Dashboard profissional respeita vínculo aprovado.
- Comentários não expõem dados de outros pacientes.
- Solicitação por e-mail encontra o paciente correto ou retorna erro amigável.
