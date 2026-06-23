import { formatCalories } from "@/lib/numberFormat";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ReportTrendChartDay = {
  date: string;
  label: string;
  calories: number;
  goalCalories: number;
  originalGoalCalories: number;
};

function getCalorieBarColor(calories: number, goalCalories: number) {
  if (!goalCalories || !calories) return "#cbd5e1";
  const ratio = calories / goalCalories;
  if (ratio > 1.05) return "#dc2626";
  if (ratio < 0.9) return "#f59e0b";
  return "#10b981";
}

export default function ReportTrendChart({ days }: { days: ReportTrendChartDay[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={days} barSize={28}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip formatter={value => formatCalories(Number(value))} />
        <Legend />
        <Bar dataKey="originalGoalCalories" name="Meta original" fill="#e2e8f0" radius={[8, 8, 0, 0]} />
        <Bar dataKey="goalCalories" name="Meta ajustada" fill="#94a3b8" radius={[8, 8, 0, 0]} />
        <Bar dataKey="calories" name="Consumido" radius={[8, 8, 0, 0]}>
          {days.map(day => <Cell key={day.date} fill={getCalorieBarColor(day.calories, day.goalCalories)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
