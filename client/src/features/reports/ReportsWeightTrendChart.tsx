import { formatNumberPtBr } from "@/lib/numberFormat";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type WeightTrendPoint = {
  date: string;
  label?: string;
  weightKg: number;
};

function formatMacro(value: number | null | undefined) {
  return formatNumberPtBr(Number(value ?? 0), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

export default function ReportsWeightTrendChart({ points }: { points: WeightTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" />
        <YAxis domain={["dataMin - 1", "dataMax + 1"]} />
        <Tooltip formatter={value => `${formatMacro(Number(value))} kg`} />
        <Legend />
        <Line type="linear" dataKey="weightKg" name="Peso" stroke="#16a34a" strokeWidth={3} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}
