import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { Border, Borders } from 'exceljs';
import { Injectable } from '@angular/core';

export type LancamentoRelatorio = {
  data: Date | string;
  descricao: string;
  categoria: string;
  tipo: 'entrada' | 'saida' | 'transferencia';
  valor: number;
  contaOrigem?: string;
  destino?: string;
  conta?: string;
};

export type LancamentoRelatorioCsv = {
  data: string;
  tipo: string;
  descricao: string;
  categoria: string;
  contaOrigem: string;
  destino: string;
  valor: number;
};

export type LancamentoRelatorioCsvAnual = LancamentoRelatorioCsv & {
  anoMes: string;
};

export type AnnualReportRow = {
  mes: string;
  entradas: number;
  saidas: number;
  saldo: number;
};

@Injectable({ providedIn: 'root' })
export class ReportExportService {
  async exportRelatorioXlsx(params: {
    titulo: string;
    filtrosTexto?: string;
    rows: LancamentoRelatorio[];
    saldoInicial?: number;
    fileName?: string;
  }): Promise<void> {
    const { titulo, filtrosTexto, rows, saldoInicial, fileName } = params;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Gest\u00e3o de Gastos';
    wb.created = new Date();

    const ws = wb.addWorksheet('Relat\u00f3rio', {
      views: [{ state: 'frozen', ySplit: 4 }]
    });

    const headers = ['Data', 'Tipo', 'Descri\u00e7\u00e3o', 'Categoria', 'Conta/Origem', 'Destino', 'Valor'];

    const thin: Border = { style: 'thin', color: { argb: 'FF111827' } };
    const hair: Border = { style: 'hair', color: { argb: 'FFE5E7EB' } };

    const fullBorder: Partial<Borders> = {
      top: thin,
      left: thin,
      bottom: thin,
      right: thin
    };

    ws.mergeCells('A1:G1');
    const titleCell = ws.getCell('A1');
    titleCell.value = titulo;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

    ws.mergeCells('A2:G2');
    const filterCell = ws.getCell('A2');
    filterCell.value = filtrosTexto ?? '';
    filterCell.font = { italic: true, color: { argb: 'FF666666' } };
    filterCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };

    const saldoRowIndex = 3;
    ws.getRow(saldoRowIndex).height = 18;
    ws.getCell(saldoRowIndex, 6).value = 'Saldo inicial';
    ws.getCell(saldoRowIndex, 6).font = { bold: true };
    ws.getCell(saldoRowIndex, 7).value = Number.isFinite(saldoInicial) ? saldoInicial : 0;
    ws.getCell(saldoRowIndex, 7).numFmt = '"R$" #,##0.00';
    ws.getCell(saldoRowIndex, 7).font = { bold: true };

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
        fgColor: { argb: 'FF1F2937' }
      };
      cell.border = fullBorder;
    }

    const startDataRow = headerRowIndex + 1;

    rows.forEach((r, idx) => {
      const rowIndex = startDataRow + idx;
      const dateVal = r.data instanceof Date ? r.data : new Date(r.data);
      const contaOrigem = r.contaOrigem ?? r.conta ?? '';
      const destino = r.destino ?? '';
      const tipo = this.normalizeTipo(r.tipo);

      ws.getRow(rowIndex).values = [
        dateVal,
        tipo,
        r.descricao ?? '',
        r.categoria ?? '',
        contaOrigem,
        destino,
        r.valor ?? 0
      ];

      ws.getCell(rowIndex, 1).numFmt = 'dd/mm/yyyy';
      ws.getCell(rowIndex, 7).numFmt = '"R$" #,##0.00';
      ws.getCell(rowIndex, 2).alignment = { horizontal: 'center' };

      const valueCell = ws.getCell(rowIndex, 7);
      if (r.tipo === 'saida') valueCell.font = { color: { argb: 'FFB91C1C' } };
      if (r.tipo === 'entrada') valueCell.font = { color: { argb: 'FF15803D' } };

      for (let c = 1; c <= headers.length; c++) {
        ws.getCell(rowIndex, c).border = { bottom: hair };
      }
    });

    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: headers.length }
    };

    const endRow = startDataRow + rows.length - 1;
    const totalRowIndex = endRow + 2;

    ws.getCell(totalRowIndex, 6).value = 'TOTAL';
    ws.getCell(totalRowIndex, 6).font = { bold: true };

    if (rows.length > 0) {
      ws.getCell(totalRowIndex, 7).value = {
        formula:
          `G${saldoRowIndex}+SUMIF(B${startDataRow}:B${endRow},"entrada",G${startDataRow}:G${endRow})` +
          `-SUMIF(B${startDataRow}:B${endRow},"sa\u00edda",G${startDataRow}:G${endRow})`
      };
    } else {
      ws.getCell(totalRowIndex, 7).value = Number.isFinite(saldoInicial) ? saldoInicial : 0;
    }

    ws.getCell(totalRowIndex, 7).numFmt = '"R$" #,##0.00';
    ws.getCell(totalRowIndex, 7).font = { bold: true };

    const widths = [12, 16, 40, 22, 18, 18, 14];
    widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const safeName = (fileName || titulo)
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const finalName = safeName.toLowerCase().endsWith('.xlsx') ? safeName : `${safeName}.xlsx`;

    saveAs(blob, finalName);
  }

  exportRelatorioCsv(params: { rows: LancamentoRelatorioCsv[]; fileName: string }): void {
    const header = ['Data', 'Tipo', 'Descri\u00e7\u00e3o', 'Categoria', 'Conta/Origem', 'Destino', 'Valor'];
    const rows = params.rows.map((row) => [
      row.data,
      this.normalizeTipo(row.tipo),
      row.descricao,
      row.categoria,
      row.contaOrigem,
      row.destino,
      this.formatCsvNumber(row.valor)
    ]);

    const csv = this.buildCsv(header, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const safeName = params.fileName
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const finalName = safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
    saveAs(blob, finalName);
  }

  exportRelatorioAnualCsv(params: { rows: LancamentoRelatorioCsvAnual[]; fileName: string }): void {
    const header = [
      'Ano-M\u00eas',
      'Data',
      'Tipo',
      'Descri\u00e7\u00e3o',
      'Categoria',
      'Conta/Origem',
      'Destino',
      'Valor'
    ];
    const rows = params.rows.map((row) => [
      row.anoMes,
      row.data,
      this.normalizeTipo(row.tipo),
      row.descricao,
      row.categoria,
      row.contaOrigem,
      row.destino,
      this.formatCsvNumber(row.valor)
    ]);

    const csv = this.buildCsv(header, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const safeName = params.fileName
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const finalName = safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
    saveAs(blob, finalName);
  }

  async exportRelatorioAnualXlsx(params: {
    titulo: string;
    rows: LancamentoRelatorio[];
    year: number;
    saldoInicial?: number;
    fileName?: string;
  }): Promise<void> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Gest\u00e3o de Gastos';
    wb.created = new Date();

    const summaryWs = wb.addWorksheet('Resumo Anual');
    summaryWs.views = [{ state: 'frozen', ySplit: 7 }];

    const saldoInicial = Number.isFinite(params.saldoInicial) ? Number(params.saldoInicial) : 0;
    const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthTotals = monthLabels.map(() => ({ entradas: 0, saidas: 0 }));

    let totalIncome = 0;
    let totalExpense = 0;

    params.rows.forEach((row) => {
      const amount = Number(row.valor) || 0;
      const tipo = this.normalizeTipo(row.tipo);
      if (tipo !== 'entrada' && tipo !== 'sa\u00edda') {
        return;
      }

      const dateVal = row.data instanceof Date ? row.data : new Date(row.data);
      if (!Number.isFinite(dateVal.getTime()) || dateVal.getFullYear() !== params.year) {
        return;
      }

      const monthIndex = dateVal.getMonth();
      if (tipo === 'entrada') {
        totalIncome += amount;
        monthTotals[monthIndex].entradas += amount;
      } else {
        totalExpense += amount;
        monthTotals[monthIndex].saidas += amount;
      }
    });

    const saldoAno = saldoInicial + totalIncome - totalExpense;

    const titleCell = summaryWs.getCell('A1');
    titleCell.value = `Resumo Anual ${params.year}`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    summaryWs.getRow(1).height = 22;
    summaryWs.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFF3F6' }
    };
    summaryWs.mergeCells('A1:D1');

    summaryWs.getCell('A3').value = 'Total de Entradas';
    summaryWs.getCell('B3').value = totalIncome;
    summaryWs.getCell('A4').value = 'Total de Sa\u00eddas';
    summaryWs.getCell('B4').value = totalExpense;
    summaryWs.getCell('A5').value = 'Saldo do Ano';
    summaryWs.getCell('B5').value = saldoAno;

    summaryWs.getCell('A3').font = { bold: true };
    summaryWs.getCell('A4').font = { bold: true };
    summaryWs.getCell('A5').font = { bold: true };
    summaryWs.getCell('B5').font = { bold: true };

    summaryWs.getCell('B3').numFmt = '"R$" #,##0.00';
    summaryWs.getCell('B4').numFmt = '"R$" #,##0.00';
    summaryWs.getCell('B5').numFmt = '"R$" #,##0.00';

    const softGreen = { argb: 'FFE8F5E9' };
    const softRed = { argb: 'FFFDECEA' };
    const softBlue = { argb: 'FFE8F1FF' };
    ['A3', 'B3'].forEach((cell) => {
      summaryWs.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: softGreen };
    });
    ['A4', 'B4'].forEach((cell) => {
      summaryWs.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: softRed };
    });
    ['A5', 'B5'].forEach((cell) => {
      summaryWs.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: softBlue };
    });

    summaryWs.getCell('A3').alignment = { horizontal: 'left' };
    summaryWs.getCell('A4').alignment = { horizontal: 'left' };
    summaryWs.getCell('A5').alignment = { horizontal: 'left' };
    summaryWs.getCell('B3').alignment = { horizontal: 'right' };
    summaryWs.getCell('B4').alignment = { horizontal: 'right' };
    summaryWs.getCell('B5').alignment = { horizontal: 'right' };

    summaryWs.getCell('A7').value = 'M\u00eas';
    summaryWs.getCell('B7').value = 'Entradas';
    summaryWs.getCell('C7').value = 'Sa\u00eddas';
    summaryWs.getCell('D7').value = 'Saldo';
    summaryWs.getRow(7).font = { bold: true };
    summaryWs.getRow(7).alignment = { vertical: 'middle', horizontal: 'left' };
    ['A7', 'B7', 'C7', 'D7'].forEach((cell) => {
      summaryWs.getCell(cell).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE5E7EB' }
      };
    });

    const tableBorder: Partial<Borders> = {
      top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
      right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
    };

    let totalEntradasMeses = 0;
    let totalSaidasMeses = 0;
    let somaSaldoMesesComMovimento = 0;
    let mesesComMovimento = 0;

    monthLabels.forEach((label, index) => {
      const rowIndex = 8 + index;
      const entradas = monthTotals[index].entradas;
      const saidas = monthTotals[index].saidas;
      const saldoMes = entradas === 0 && saidas === 0 ? 0 : saldoInicial + entradas - saidas;

      totalEntradasMeses += entradas;
      totalSaidasMeses += saidas;
      if (entradas > 0 || saidas > 0) {
        somaSaldoMesesComMovimento += saldoMes;
        mesesComMovimento += 1;
      }

      summaryWs.getCell(rowIndex, 1).value = label;
      summaryWs.getCell(rowIndex, 2).value = entradas;
      summaryWs.getCell(rowIndex, 3).value = saidas;
      summaryWs.getCell(rowIndex, 4).value = saldoMes;

      summaryWs.getCell(rowIndex, 2).numFmt = '"R$" #,##0.00';
      summaryWs.getCell(rowIndex, 3).numFmt = '"R$" #,##0.00';
      summaryWs.getCell(rowIndex, 4).numFmt = '"R$" #,##0.00';

      summaryWs.getCell(rowIndex, 1).alignment = { horizontal: 'left' };
      summaryWs.getCell(rowIndex, 2).alignment = { horizontal: 'right' };
      summaryWs.getCell(rowIndex, 3).alignment = { horizontal: 'right' };
      summaryWs.getCell(rowIndex, 4).alignment = { horizontal: 'right' };

      for (let col = 1; col <= 4; col++) {
        summaryWs.getCell(rowIndex, col).border = tableBorder;
      }
    });

    const totalRowIndex = 8 + monthLabels.length;
    const mediaSaldo = mesesComMovimento > 0 ? somaSaldoMesesComMovimento / mesesComMovimento : 0;

    summaryWs.getCell(totalRowIndex, 1).value = 'TOTAL';
    summaryWs.getCell(totalRowIndex, 2).value = totalEntradasMeses;
    summaryWs.getCell(totalRowIndex, 3).value = totalSaidasMeses;
    summaryWs.getCell(totalRowIndex, 4).value = mediaSaldo;
    summaryWs.getRow(totalRowIndex).font = { bold: true };

    summaryWs.getCell(totalRowIndex, 2).numFmt = '"R$" #,##0.00';
    summaryWs.getCell(totalRowIndex, 3).numFmt = '"R$" #,##0.00';
    summaryWs.getCell(totalRowIndex, 4).numFmt = '"R$" #,##0.00';

    summaryWs.getCell(totalRowIndex, 1).alignment = { horizontal: 'left' };
    summaryWs.getCell(totalRowIndex, 2).alignment = { horizontal: 'right' };
    summaryWs.getCell(totalRowIndex, 3).alignment = { horizontal: 'right' };
    summaryWs.getCell(totalRowIndex, 4).alignment = { horizontal: 'right' };

    for (let col = 1; col <= 4; col++) {
      summaryWs.getCell(totalRowIndex, col).border = tableBorder;
    }

    ['A7', 'B7', 'C7', 'D7'].forEach((cell) => {
      summaryWs.getCell(cell).border = tableBorder;
    });

    summaryWs.getColumn(1).width = 26;
    summaryWs.getColumn(2).width = 18;
    summaryWs.getColumn(3).width = 18;
    summaryWs.getColumn(4).width = 18;

    summaryWs.autoFilter = {
      from: { row: 7, column: 1 },
      to: { row: 7, column: 4 }
    };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const safeName = (params.fileName || params.titulo)
      .replace(/[\\/:*?"<>|]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const finalName = safeName.toLowerCase().endsWith('.xlsx') ? safeName : `${safeName}.xlsx`;
    saveAs(blob, finalName);
  }

  private normalizeTipo(tipo?: string) {
    if (tipo === 'saida') return 'sa\u00edda';
    if (tipo === 'transferencia') return 'transfer\u00eancia';
    return tipo ?? '';
  }

  private buildCsv(headers: string[], rows: Array<Array<string | number>>, delimiter = ';') {
    const bom = '\uFEFF';
    const lines = rows.map((row) => row.map((value) => this.escapeCsv(value, delimiter)).join(delimiter));
    return `${bom}${[headers.join(delimiter), ...lines].join('\n')}`;
  }

  private formatCsvNumber(value: number) {
    if (!Number.isFinite(value)) {
      return '0.00';
    }
    return Number(value).toFixed(2);
  }

  private escapeCsv(value: string | number, delimiter = ';') {
    const str = `${value ?? ''}`;
    if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/\"/g, '""')}"`;
    }
    return str;
  }
}
