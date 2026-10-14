// Состояние чекбоксов: явные отметки по относительным путям; эффективное
// состояние узла — ближайшая отметка у него или у предка (по умолчанию — нет).
// Отметить папку = выбрать всё внутри, в т.ч. файлы, которые появятся позже.

export class SelectionState {
  private readonly marks = new Map<string, boolean>();

  set(relPath: string, checked: boolean): void {
    for (const key of [...this.marks.keys()]) {
      if (isDescendant(key, relPath)) this.marks.delete(key);
    }
    // Отметка, совпадающая с унаследованной, избыточна.
    if (this.inherited(relPath) === checked) this.marks.delete(relPath);
    else this.marks.set(relPath, checked);
  }

  clear(): void {
    this.marks.clear();
  }

  isSelected(relPath: string): boolean {
    for (let p: string | null = relPath; p !== null; p = parent(p)) {
      const mark = this.marks.get(p);
      if (mark !== undefined) return mark;
    }
    return false;
  }

  /** Есть ли ниже папки явно отмеченное (стоит ли в неё спускаться). */
  hasSelectedDescendants(relPath: string): boolean {
    for (const [key, value] of this.marks) {
      if (value && isDescendant(key, relPath)) return true;
    }
    return false;
  }

  /** Папка выбрана частично: ниже есть отметки, отличные от её состояния. */
  isPartial(relPath: string): boolean {
    const own = this.isSelected(relPath);
    for (const [key, value] of this.marks) {
      if (value !== own && isDescendant(key, relPath)) return true;
    }
    return false;
  }

  get isEmpty(): boolean {
    return ![...this.marks.values()].some(Boolean);
  }

  toJSON(): [string, boolean][] {
    return [...this.marks];
  }

  static fromJSON(data: unknown): SelectionState {
    const state = new SelectionState();
    if (Array.isArray(data)) {
      for (const item of data) {
        if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'boolean') {
          state.marks.set(item[0], item[1]);
        }
      }
    }
    return state;
  }

  private inherited(relPath: string): boolean {
    const p = parent(relPath);
    return p === null ? false : this.isSelected(p);
  }
}

/** '' — корень; у корня родителя нет. */
function parent(relPath: string): string | null {
  if (relPath === '') return null;
  const i = relPath.lastIndexOf('/');
  return i === -1 ? '' : relPath.slice(0, i);
}

function isDescendant(path: string, ancestor: string): boolean {
  if (ancestor === '') return path !== '';
  return path.startsWith(ancestor + '/');
}
