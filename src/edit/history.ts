export interface Command<Document> {
  readonly label: string;
  apply: (document: Document) => Document;
  revert: (document: Document) => Document;
}

export interface History<Document> {
  document: Document;
  readonly undoStack: Command<Document>[];
  readonly redoStack: Command<Document>[];
}

export function createHistory<Document>(document: Document): History<Document> {
  return { document, undoStack: [], redoStack: [] };
}

export function executeCommand<Document>(history: History<Document>, command: Command<Document>): void {
  // Only mutate history after the command succeeds.
  const next = command.apply(history.document);
  history.document = next;
  history.undoStack.push(command);
  history.redoStack.length = 0;
}

export function undo<Document>(history: History<Document>): boolean {
  const command = history.undoStack.at(-1);
  if (!command) return false;
  const previous = command.revert(history.document);
  history.document = previous;
  history.undoStack.pop();
  history.redoStack.push(command);
  return true;
}

export function redo<Document>(history: History<Document>): boolean {
  const command = history.redoStack.at(-1);
  if (!command) return false;
  const next = command.apply(history.document);
  history.document = next;
  history.redoStack.pop();
  history.undoStack.push(command);
  return true;
}
