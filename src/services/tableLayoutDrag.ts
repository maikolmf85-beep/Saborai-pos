import type { Table } from '../types';

/**
 * Mantiene el último plano editado durante el arrastre, incluso si React aún no
 * ha renderizado la actualización de estado correspondiente al último pointermove.
 */
export class TableLayoutDragDraft {
  private tables: Table[];

  constructor(tables: Table[]) {
    this.tables = tables;
  }

  reset(tables: Table[]): void {
    this.tables = tables;
  }

  move(tableId: string, x: number, y: number): Table[] {
    this.tables = this.tables.map(table =>
      table.id === tableId ? { ...table, x, y } : table
    );
    return this.tables;
  }

  commit(onUpdateTables?: (tables: Table[]) => void): void {
    onUpdateTables?.(this.tables);
  }
}
