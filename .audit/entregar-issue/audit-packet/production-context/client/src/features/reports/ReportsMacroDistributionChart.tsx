import { formatNumberPtBr } from "@/lib/numberFormat";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type MacroDistributionChartItem = {
  macro: string;
  planejado: number;
  realizado: number;
};

function formatPercent(value: number | null | undefined) {
  return `${formatNumberPtBr(Number(value ?? 0), { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

export default function ReportsMacroDistributionChart({ data }: { data: MacroDistributionChartItem[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barSize={32}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="macro" />
        <YAxis tickFormatter={value => `${value}%`} />
        <Tooltip formatter={value => formatPercent(Number(value))} />
        <Legend />
        <Bar dataKey="planejado" name="Planejado" fill="#94a3b8" radius={[8, 8, 0, 0]} />
        <Bar dataKey="realizado" name="Realizado" fill="#16a34a" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
