# Timezone no backend e nos relatórios

As operações autenticadas de Hoje, metas e Relatórios resolvem o timezone efetivo do dono dos dados uma vez e propagam o mesmo valor a todos os serviços envolvidos. Em acesso profissional, o dono é o paciente.

Os filtros por dia, semana e período são convertidos do calendário local para UTC usando intervalos semiabertos. Refeições, exercícios, água, peso e metas preservam timestamps absolutos e derivam agrupamentos e rótulos no timezone efetivo.

A integração Strava mantém `start_date` como instante absoluto. Apenas a apresentação da data usa o timezone do usuário.
