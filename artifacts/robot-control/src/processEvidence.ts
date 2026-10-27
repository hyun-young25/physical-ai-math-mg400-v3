import { getEvidenceItem, setEvidenceItem, removeEvidenceItem } from "./learningSync";
/** Keep frequent playback checkpoints small without discarding research history. */
export function createProcessEvidenceStore<T extends { id: string }>(options: {
  key: string;
  isRecord: (value: unknown) => value is T;
  isCheckpoint?: (value: unknown) => boolean;
  recoverCheckpoint: (checkpoint: T, saved: T | undefined) => T | null;
  normalizeRecord?: (record: T) => T;
}) {
  const checkpointKey = `${options.key}:active-run`;
  const records: unknown[] = [];
  const backups: { history?: string; checkpoint?: string } = {};
  let historyBlocked = false, checkpointBlocked = false;
  let activeCheckpoint: T | undefined;
  let checkpointArchived = false;
  const copy = <V,>(value: V): V => JSON.parse(JSON.stringify(value));
  const indexOf = (id: string) => records.findIndex(value => options.isRecord(value) && value.id === id);
  const remember = (record: T) => {
    const index = indexOf(record.id), snapshot = copy(record);
    if (index < 0) records.push(snapshot); else records[index] = snapshot;
  };
  try {
    const raw = getEvidenceItem(options.key);
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("History must be an array");
        records.push(...parsed);
      } catch { backups.history = raw; historyBlocked = true; }
    }
  } catch { historyBlocked = true; }
  const originalHistory = JSON.stringify(records);
  try {
    const raw = getEvidenceItem(checkpointKey);
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!options.isRecord(parsed) || (options.isCheckpoint && !options.isCheckpoint(parsed))) throw new Error("Unknown checkpoint format");
        activeCheckpoint = parsed;
        const saved = records[indexOf(parsed.id)];
        const recovered = options.recoverCheckpoint(parsed, options.isRecord(saved) ? saved : undefined);
        if (recovered) remember(recovered);
      } catch { backups.checkpoint = raw; checkpointBlocked = true; }
    }
  } catch { checkpointBlocked = true; }
  if (options.normalizeRecord) for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (options.isRecord(record)) records[index] = options.normalizeRecord(record);
  }
  let failed = historyBlocked || checkpointBlocked;
  // Send recovered stop states, but never overwrite unreadable history.
  if (!failed && records.length && JSON.stringify(records) !== originalHistory) {
    try { setEvidenceItem(options.key, JSON.stringify(records)); } catch { historyBlocked = true; failed = true; }
  }
  const writeCheckpoint = (record: T): boolean => {
    if (checkpointBlocked) return false;
    // If a previous run could not be committed, retain its only durable copy.
    if (activeCheckpoint && activeCheckpoint.id !== record.id && !checkpointArchived) return false;
    try {
      setEvidenceItem(checkpointKey, JSON.stringify(record));
      activeCheckpoint = copy(record);
      checkpointArchived = false;
      return true;
    } catch { return false; }
  };
  return {
    records, backups, failed, checkpointKey,
    /** Update only this run, rather than stringify every previous attempt during RAF. */
    checkpoint(record: T): boolean {
      remember(record);
      return writeCheckpoint(record);
    },
    /** Terminal writes retain the full history, then remove the redundant checkpoint. */
    save(record: T, terminal = false): boolean {
      remember(record);
      if (historyBlocked) { if (terminal) writeCheckpoint(record); return false; }
      try {
        setEvidenceItem(options.key, JSON.stringify(records));
        checkpointArchived = true;
        if (terminal && !checkpointBlocked && activeCheckpoint?.id === record.id) {
          removeEvidenceItem(checkpointKey);
          activeCheckpoint = undefined;
        }
        return !checkpointBlocked;
      } catch { if (terminal) writeCheckpoint(record); return false; }
    },
  };
}
