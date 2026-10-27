type ConceptColumn = {
  title: string;
  notation: string;
  description: string;
};

type LessonConceptHeaderProps = {
  section: string;
  label: string;
  title: string;
  duration?: string;
  definition: string;
  columns: ConceptColumn[];
  showColumns?: boolean;
};

export function LessonConceptHeader({
  section,
  label,
  title,
  duration = "약 5분",
  definition,
  columns,
  showColumns = true,
}: LessonConceptHeaderProps) {
  return (
    <section className="lesson-concept-header" aria-label="학습 개념 안내">
      <div className="lesson-concept-header__topline">
        <span className="lesson-concept-header__number">{section}</span>
        <div>
          <div className="lesson-concept-header__label">{label}</div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="lesson-concept-header__definition">
        <strong>핵심 개념</strong>
        <p>{definition}</p>
      </div>
      {showColumns && (
        <div className="lesson-concept-header__columns">
          {columns.slice(0, 3).map((column) => (
            <div className="lesson-concept-header__column" key={column.title}>
              <strong>{column.title}</strong>
              <b>{column.notation}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
