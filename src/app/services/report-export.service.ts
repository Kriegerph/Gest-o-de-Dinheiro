import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Border, Borders } from 'exceljs';
import { Injectable } from '@angular/core';

export type LancamentoRelatorio = {
  data: Date | string;
  descricao: string;
  categoria: string;
  tipo: 'entrada' | 'saida';
  valor: number;
  conta?: string;
  formaPgto?: string;
  tags?: string[];
};

@Injectable({ providedIn: 'root' })
export class ReportExportService {
  async exportRelatorioXlsx(params: {
    titulo: string;
    filtrosTexto?: string;
    rows: LancamentoRelatorio[];
  }): Promise<void> {
    const { titulo, filtrosTexto, rows } = params;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Gestão de Gastos';
    wb.created = new Date();

    const ws = wb.addWorksheet('Relatório', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    const headers = [
      'Data',
      'Descrição',
      'Categoria',
      'Tipo',
      'Valor',
      'Conta',
      'Forma Pgto',
      'Tags',
    ];

    // Helpers tipados (evita TS2322)
    const thin: Border = { style: 'thin', color: { argb: 'FF111827' } };
    const hair: Border = { style: 'hair', color: { argb: 'FFE5E7EB' } };

    const fullBorder: Partial<Borders> = {
      top: thin,
      left: thin,
      bottom: thin,
      right: thin,
    };

    // ===== Título
    ws.mergeCells('A1:H1');
    const titleCell = ws.getCell('A1');
    titleCell.value = titulo;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

    // ===== Filtros
    ws.mergeCells('A2:H2');
    const filterCell = ws.getCell('A2');
    filterCell.value = filtrosTexto ?? '';
    filterCell.font = { italic: true, color: { argb: 'FF666666' } };
    filterCell.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      wrapText: true,
    };

    ws.getRow(3).height = 6;

    // ===== Cabeçalho
    const headerRowIndex = 4;
    const headerRow = ws.getRow(headerRowIndex);
    headerRow.values = headers;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRow.height = 20;

    for (let i = 1; i <= headers.length; i++) {
      const cell = ws.getCell(headerRowIndex, i);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F2937' },
      };
      cell.border = fullBorder;
    }

    // ===== Dados
    const startDataRow = headerRowIndex + 1;

    rows.forEach((r, idx) => {
      const rowIndex = startDataRow + idx;

      const dateVal = r.data instanceof Date ? r.data : new Date(r.data);

      ws.getRow(rowIndex).values = [
        dateVal,
        r.descricao ?? '',
        r.categoria ?? '',
        r.tipo ?? '',
        r.valor ?? 0,
        r.conta ?? '',
        r.formaPgto ?? '',
        (r.tags ?? []).join(', '),
      ];

      // Formatos
      ws.getCell(rowIndex, 1).numFmt = 'dd/mm/yyyy';
      ws.getCell(rowIndex, 5).numFmt = '"R$" #,##0.00';
      ws.getCell(rowIndex, 4).alignment = { horizontal: 'center' };

      // Cor do valor por tipo
      const valueCell = ws.getCell(rowIndex, 5);
      if (r.tipo === 'saida') valueCell.font = { color: { argb: 'FFB91C1C' } };
      if (r.tipo === 'entrada') valueCell.font = { color: { argb: 'FF15803D' } };

      // Bordas leves nos dados
      for (let c = 1; c <= headers.length; c++) {
        ws.getCell(rowIndex, c).border = { bottom: hair };
      }
    });

    // ===== AutoFilter
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: headers.length },
    };

    // ===== Total
    // ===== Total
    const endRow = startDataRow + rows.length - 1;
    const totalRowIndex = endRow + 2;

    ws.getCell(totalRowIndex, 4).value = 'TOTAL';
    ws.getCell(totalRowIndex, 4).font = { bold: true };

    if (rows.length > 0) {
      ws.getCell(totalRowIndex, 5).value = {
        formula:
          `SUMIF(D${startDataRow}:D${endRow},"entrada",E${startDataRow}:E${endRow})` +
          `-SUMIF(D${startDataRow}:D${endRow},"saída",E${startDataRow}:E${endRow})`,
      };
    } else {
      ws.getCell(totalRowIndex, 5).value = 0;
    }

    ws.getCell(totalRowIndex, 5).numFmt = '"R$" #,##0.00';
    ws.getCell(totalRowIndex, 5).font = { bold: true };


    // ===== Larguras
    const widths = [12, 40, 22, 10, 14, 18, 18, 28];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

    // ===== Salvar
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const safeName = titulo
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .replace(/\s+/g, '_');

    saveAs(blob, `${safeName}.xlsx`);
  }
}
