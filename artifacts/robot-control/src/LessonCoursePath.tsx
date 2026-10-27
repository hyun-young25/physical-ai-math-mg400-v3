export function LessonCoursePath({ label, current, items, onSelect, disabled = false }: {
  label: string; current: number; items: readonly { label: string; detail?: string; complete?: boolean }[];
  onSelect: (index: number) => void; disabled?: boolean;
}) {
  return <nav className="math-course-strip lesson-course-path" aria-label={label}>
    <div className="math-course-summary">
      {items.map((item, index) => <button key={index} type="button" disabled={disabled}
        className={index === current ? "is-current" : item.complete ? "is-done" : ""}
        aria-current={index === current ? "step" : undefined}
        aria-label={`${index + 1}. ${item.detail ?? item.label}${item.complete ? " · 완료" : ""}`}
        title={item.detail ?? item.label} onClick={() => onSelect(index)}>
        <b>{item.complete ? "✓" : index + 1}</b>{item.label}
      </button>)}
    </div>
  </nav>;
}
