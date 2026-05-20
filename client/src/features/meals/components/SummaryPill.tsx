type SummaryPillProps = {
  label: string;
  value: string;
};

export function SummaryPill({ label, value }: SummaryPillProps) {
  return (
    <div className="rounded-2xl bg-background p-4 text-center shadow-sm">
      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-tight">{value}</p>
    </div>
  );
}
