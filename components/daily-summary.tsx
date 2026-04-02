interface DailySummaryProps {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export function DailySummary({
  calories,
  protein,
  carbs,
  fat,
  fiber,
}: DailySummaryProps) {
  return (
    <div className="grid grid-cols-5 gap-3">
      <MacroCard label="Cal" value={calories} unit="" />
      <MacroCard label="Protein" value={Math.round(protein)} unit="g" />
      <MacroCard label="Carbs" value={Math.round(carbs)} unit="g" />
      <MacroCard label="Fat" value={Math.round(fat)} unit="g" />
      <MacroCard label="Fiber" value={Math.round(fiber)} unit="g" />
    </div>
  );
}

function MacroCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-center">
      <div className="text-lg font-semibold">
        {value}
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}
