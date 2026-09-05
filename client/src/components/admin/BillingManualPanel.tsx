import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BookOpen, CircleHelp } from "lucide-react";
import React from "react";

const accessReasons = [
  "Liberação administrativa",
  "Cobertura profissional",
  "Assinatura ativa",
  "Período de avaliação ativo",
  "Período de transição",
  "Somente leitura",
  "Acesso aberto",
  "Sem acesso",
];

const quickReference = [
  ["Ver assinaturas e inadimplentes", "Visão geral"],
  ["Descobrir por que um usuário tem ou não acesso", "Acessos"],
  ["Liberar ou revogar acesso excepcional", "Acessos"],
  ["Criar produto, versão ou cupom", "Comercial"],
  ["Publicar ou encerrar uma versão", "Comercial"],
  ["Reprocessar WhatsApp ou e-mail", "Comercial"],
  ["Acompanhar receita, custos e cobertura", "Governança"],
  ["Conceder franquia temporária", "Governança"],
  ["Investigar possível abuso ou registrar retenção legal", "Governança"],
  ["Controlar grupos, decisões de avanço, pausas e reversões", "Implantação"],
];

export default function BillingManualPanel() {
  return (
    <section className="space-y-6" aria-labelledby="billing-manual-title">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle id="billing-manual-title" className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Manual de utilização
              </CardTitle>
              <CardDescription>
                Consulte aqui como operar planos, acessos, catálogo, campanhas, governança e implantação gradual.
                Este conteúdo acompanha as funcionalidades disponibilizadas nesta tela.
              </CardDescription>
            </div>
            <Badge variant="outline">Somente administradores</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-6">
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="font-medium">Regra principal</p>
            <p className="mt-1 text-muted-foreground">
              Liberações administrativas, franquias temporárias e controles de implantação não criam
              cobrança nem assinatura. Use cada função somente para a finalidade indicada no manual.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              ["Visão geral", "Acompanhar situação comercial e receita estimada."],
              ["Acessos", "Consultar a forma de acesso e administrar exceções."],
              ["Comercial", "Gerenciar planos, cupons e comunicações."],
              ["Governança", "Analisar economia, uso e exceções operacionais."],
              ["Implantação", "Controlar a aplicação gradual das regras comerciais."],
            ].map(([title, description]) => (
              <div key={title} className="rounded-xl border p-3">
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <ManualSection title="1. Visão geral" summary="Indicadores de contratos, planos e receita recorrente.">
        <p>
          A aba <strong>Visão geral</strong> é consultiva. No topo da página também aparecem os indicadores de
          assinaturas ativas, inadimplentes, usuários sem acesso comercial válido e liberações
          administrativas ativas.
        </p>
        <div className="space-y-2">
          <h4 className="font-medium">Distribuição por plano e ciclo</h4>
          <p className="text-muted-foreground">
            Para cada versão de plano, confira nome, versão comercial, ciclo, moeda, disponibilidade para
            contratação, assinaturas por situação, beneficiários cobertos e capacidade ocupada.
          </p>
        </div>
        <div className="space-y-2">
          <h4 className="font-medium">Receita recorrente estimada</h4>
          <p className="text-muted-foreground">
            O valor é um indicador operacional separado por moeda. Ele apoia o acompanhamento
            administrativo e não substitui o fechamento e a conferência financeira.
          </p>
        </div>
      </ManualSection>

      <ManualSection title="2. Acessos" summary="Pesquisa de usuários, forma de acesso e liberações administrativas." open>
        <div className="space-y-2">
          <h4 className="font-medium">Localizar um usuário</h4>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Pesquise por nome, e-mail ou telefone.</li>
            <li>Se necessário, filtre pela forma de acesso.</li>
            <li>Selecione o usuário para consultar sua situação e o histórico de liberações.</li>
          </ol>
          <p className="text-muted-foreground">
            Formas de acesso disponíveis: {accessReasons.join(", ")}.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Conceder liberação administrativa</h4>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Selecione o usuário.</li>
            <li>Informe um motivo claro para a exceção.</li>
            <li>Opcionalmente, defina início e término.</li>
            <li>Clique em <strong>Conceder liberação</strong>.</li>
          </ol>
          <p className="text-muted-foreground">
            Motivo, autoria e vigência ficam registrados. A liberação não cria pagamento, assinatura ou
            quitação.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Histórico e revogação</h4>
          <p className="text-muted-foreground">
            O histórico identifica liberações ativas, revogadas e expiradas. Para revogar uma liberação
            ativa, informe o motivo da revogação e clique em <strong>Revogar liberação</strong>. O registro
            permanece visível depois da revogação.
          </p>
        </div>
      </ManualSection>

      <ManualSection title="3. Comercial" summary="Planos, versões, cupons, campanhas e entregas.">
        <div className="space-y-2">
          <h4 className="font-medium">Criar produto</h4>
          <p className="text-muted-foreground">
            Clique em <strong>Novo produto</strong>, informe código, nome, público e motivo. O produto é a
            família comercial e sua criação não altera contratos existentes.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Criar e publicar uma versão</h4>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Clique em <strong>Nova versão</strong>.</li>
            <li>Informe produto, nome, preço, capacidade opcional, recursos, ciclo e motivo.</li>
            <li>Crie o rascunho.</li>
            <li>Quando estiver aprovado, informe o motivo da ação e clique em <strong>Publicar</strong>.</li>
          </ol>
          <p className="text-muted-foreground">
            Mudanças de preço, capacidade ou benefícios devem usar nova versão. Contratos existentes
            permanecem na versão originalmente contratada.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Encerrar uma versão</h4>
          <p className="text-muted-foreground">
            Informe um motivo, clique em <strong>Encerrar</strong> e confirme. A versão deixa de aceitar novas
            contratações sem reescrever contratos existentes.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Criar ou desativar cupom</h4>
          <p className="text-muted-foreground">
            Em <strong>Novo cupom</strong>, informe código, percentual, quantidade de cobranças, ciclos,
            produtos elegíveis e motivo. O percentual público aceito é inteiro entre 1% e 30%. No ciclo
            mensal, o desconto pode durar de 1 a 3 cobranças; se houver ciclo anual, vale somente para a
            primeira cobrança. Desativar um cupom impede novos usos e preserva utilizações já confirmadas.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Campanhas e entregas</h4>
          <p className="text-muted-foreground">
            Use os filtros para localizar comunicações por campanha, versão, categoria, público, evento,
            etapa, canal e situação. Cada item mantém separadas a central interna, e-mail, WhatsApp,
            tentativas de envio, reprocessamentos e a referência do registro original.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li><strong>Reprocessar WhatsApp / Reprocessar e-mail:</strong> exige motivo registrado.</li>
            <li><strong>Pausar campanha:</strong> interrompe novas tentativas sem apagar o histórico.</li>
            <li><strong>Retomar campanha:</strong> volta a permitir novas entregas.</li>
            <li><strong>Reconhecer falha:</strong> atribui uma falha definitiva a um responsável administrativo.</li>
          </ul>
        </div>
      </ManualSection>

      <ManualSection title="4. Governança" summary="Economia, franquias temporárias, possível abuso e retenção.">
        <div className="space-y-2">
          <h4 className="font-medium">Economia e governança de uso</h4>
          <p className="text-muted-foreground">
            A visão econômica apresenta competência, receita, descontos, reembolsos, estornos, impostos,
            receita líquida, custo variável, índices, custo financeiro e cobertura. É uma visão gerencial e
            não substitui escrituração contábil nem a conferência financeira.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Economia por identidade comercial</h4>
          <p className="text-muted-foreground">
            Filtre por competência, usuário, patrocinador, produto, versão e ciclo. Pagador, beneficiário e
            patrocinador permanecem identidades distintas; a receita continua vinculada ao contrato e ao
            pagador.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Franquia temporária</h4>
          <p className="text-muted-foreground">
            Informe usuário, unidades adicionais, término e motivo. A franquia concede capacidade temporária
            de uso e não gera cobrança.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Possível abuso</h4>
          <p className="text-muted-foreground">
            Custo elevado isoladamente não comprova abuso. Abra um caso somente com sinais e operações
            relacionadas. O fluxo permite atribuição, revisão humana, descarte, aprovação de limitação,
            limitação temporária, reversão e análise de recurso.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Retenção legal</h4>
          <p className="text-muted-foreground">
            A retenção legal impede a eliminação somente dos dados associados ao usuário e ao motivo
            documentados. A administração pode registrar, consultar e revogar retenções, além de reprocessar
            a rotina de retenção quando necessário. A revogação preserva o histórico.
          </p>
        </div>
      </ManualSection>

      <ManualSection title="5. Implantação" summary="Grupos, pausa, retomada, reversões, decisões de avanço e incidentes.">
        <p className="text-muted-foreground">
          A implantação gradual é uma área operacional sensível e sua progressão é sempre manual. Nenhuma
          ação desta aba cria cobrança ou assinatura.
        </p>

        <div className="space-y-2">
          <h4 className="font-medium">Definir grupo da etapa</h4>
          <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Selecione a etapa e o percentual.</li>
            <li>Informe o identificador do grupo, a versão da regra e o critério de seleção.</li>
            <li>Informe os IDs dos usuários candidatos e o motivo.</li>
            <li>Clique em <strong>Registrar grupo</strong>.</li>
          </ol>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Pausar, retomar e registrar reversão</h4>
          <p className="text-muted-foreground">
            A pausa exige justificativa. Retomada e reversão exigem confirmação reforçada do administrador.
            Essas ações preservam cobranças, assinaturas, estornos, cancelamentos, capacidade e demais
            registros legítimos já existentes.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Decisão manual de avanço</h4>
          <p className="text-muted-foreground">
            Registre a decisão de manter, avançar ou reprovar a etapa, identificando responsáveis de Produto,
            Técnico, Financeiro/comercial, Suporte e administrador autorizador, além das métricas, evidências
            e motivo da decisão.
          </p>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium">Incidentes</h4>
          <p className="text-muted-foreground">
            Registre tipo, severidade, causa e impacto. Incidentes relevantes podem impedir o avanço da etapa
            até a avaliação apropriada.
          </p>
        </div>
      </ManualSection>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleHelp className="h-5 w-5" />
            Consulta rápida
          </CardTitle>
          <CardDescription>Use esta tabela para localizar rapidamente a área correta.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Necessidade</th>
                <th className="p-3">Onde realizar</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {quickReference.map(([need, area]) => (
                <tr key={need}>
                  <td className="p-3">{need}</td>
                  <td className="p-3 font-medium">{area}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-dashed p-4 text-sm leading-6 text-muted-foreground">
        Sempre registre motivos claros e específicos. Evite usar liberações, franquias, cupons ou controles
        de implantação para simular pagamento, assinatura, cancelamento ou conferência financeira.
      </div>
    </section>
  );
}

function ManualSection({
  title,
  summary,
  children,
  open = false,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group rounded-2xl border bg-card">
      <summary className="cursor-pointer list-none p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold tracking-tight">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          </div>
          <span aria-hidden="true" className="mt-1 text-muted-foreground transition-transform group-open:rotate-180">
            ▾
          </span>
        </div>
      </summary>
      <div className="space-y-5 border-t px-5 py-5 text-sm leading-6">{children}</div>
    </details>
  );
}
