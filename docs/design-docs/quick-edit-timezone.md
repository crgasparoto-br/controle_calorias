# Timezone na edição rápida

Links públicos de edição rápida continuam usando token opaco, sem expor `userId` ou IDs internos. Após validar o token, o backend identifica o dono do registro e retorna apenas o timezone efetivo necessário para a interface.

A interface exibe o instante no timezone do dono e envia o valor civil `dateTimeLocal`. O backend não aceita timezone arbitrário do cliente: resolve novamente o dono, converte o horário civil com `shared/timeZone.ts` e persiste o instante absoluto.

Regras:

- navegador nunca é autoridade de conversão;
- horário inexistente por DST retorna erro de entrada claro;
- horário ambíguo usa a primeira ocorrência determinística;
- salvar o mesmo minuto civil preserva o instante original completo, inclusive segundos e milissegundos;
- token inválido, expirado ou de outro registro não revela timezone nem dados do dono;
- falha técnica ao resolver perfil/timezone interrompe a alteração, sem fallback silencioso.
