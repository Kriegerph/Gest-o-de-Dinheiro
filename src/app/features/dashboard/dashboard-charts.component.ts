import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

type TopCategoria = {
  categoryName: string;
  total: number;
  categoryColor?: string;
};

type DailySerie = {
  day: number;
  total: number;
};

type ContaSaldo = {
  name: string;
  currentBalance: number;
  color?: string;
};

type BarRow = {
  label: string;
  value: number;
  color: string;
  y: number;
  width: number;
  labelY: number;
};

type LineLabel = {
  x: number;
  text: string;
};

type DonutSegment = {
  label: string;
  value: number;
  percent: number;
  color: string;
  path: string;
};

@Component({
  selector: 'app-dashboard-charts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard-charts.component.html',
  styleUrl: './dashboard-charts.component.css'
})
export class DashboardChartsComponent implements OnChanges {
  @Input() topCategorias: TopCategoria[] = [];
  @Input() seriesDiariaEntradas: DailySerie[] = [];
  @Input() seriesDiariaSaidas: DailySerie[] = [];
  @Input() contasSaldos: ContaSaldo[] = [];

  readonly barChartWidth = 360;
  readonly barChartLabelWidth = 130;
  readonly barChartValuePadding = 72;
  readonly barChartBarHeight = 10;
  readonly barChartRowHeight = 22;
  readonly barChartTop = 12;

  barChartHeight = 140;
  barChartViewBox = `0 0 ${this.barChartWidth} ${this.barChartHeight}`;
  barAreaX = this.barChartLabelWidth;
  barTrackWidth = this.barChartWidth - this.barChartLabelWidth - this.barChartValuePadding;
  barValueX = this.barChartWidth - 6;
  barRows: BarRow[] = [];
  barChartEmpty = true;

  readonly lineChartWidth = 360;
  readonly lineChartHeight = 160;
  readonly linePaddingX = 14;
  readonly linePaddingTop = 12;
  readonly linePaddingBottom = 26;

  lineChartViewBox = `0 0 ${this.lineChartWidth} ${this.lineChartHeight}`;
  linePlotWidth = this.lineChartWidth - this.linePaddingX * 2;
  linePlotHeight = this.lineChartHeight - this.linePaddingTop - this.linePaddingBottom;
  lineIncomePath = '';
  lineExpensePath = '';
  lineGrid: number[] = [];
  lineLabels: LineLabel[] = [];
  lineLabelY = this.lineChartHeight - 8;
  lineChartEmpty = true;

  readonly donutSize = 200;
  readonly donutCenter = 100;
  readonly donutOuterRadius = 72;
  readonly donutInnerRadius = 44;

  donutViewBox = `0 0 ${this.donutSize} ${this.donutSize}`;
  donutSegments: DonutSegment[] = [];
  donutTotal = 0;
  donutChartEmpty = true;

  private palette = ['#5ad1ff', '#f2a65a', '#6ee7b7', '#f472b6', '#facc15', '#60a5fa'];

  ngOnChanges(): void {
    this.buildBarChart();
    this.buildLineChart();
    this.buildDonutChart();
  }

  private buildBarChart() {
    const data = (this.topCategorias ?? []).filter((item) => item.total > 0);
    const maxValue = Math.max(...data.map((item) => item.total), 0);
    this.barChartEmpty = data.length === 0 || maxValue <= 0;
    this.barAreaX = this.barChartLabelWidth;
    this.barTrackWidth = this.barChartWidth - this.barChartLabelWidth - this.barChartValuePadding;
    this.barValueX = this.barChartWidth - 6;

    if (this.barChartEmpty) {
      this.barRows = [];
      this.barChartHeight = 120;
      this.barChartViewBox = `0 0 ${this.barChartWidth} ${this.barChartHeight}`;
      return;
    }

    this.barChartHeight = Math.max(120, this.barChartTop + data.length * this.barChartRowHeight);
    this.barChartViewBox = `0 0 ${this.barChartWidth} ${this.barChartHeight}`;

    this.barRows = data.map((item, index) => {
      const y = this.barChartTop + index * this.barChartRowHeight;
      const width = maxValue > 0 ? (item.total / maxValue) * this.barTrackWidth : 0;
      return {
        label: item.categoryName || 'Categoria',
        value: item.total,
        color: item.categoryColor || this.palette[index % this.palette.length],
        y,
        width,
        labelY: y + this.barChartBarHeight / 2
      };
    });
  }

  private buildLineChart() {
    const incomeSeries = this.seriesDiariaEntradas ?? [];
    const expenseSeries = this.seriesDiariaSaidas ?? [];
    const totalDays = Math.max(incomeSeries.length, expenseSeries.length);
    const allValues = [...incomeSeries, ...expenseSeries].map((item) => item.total);
    const maxValue = Math.max(...allValues, 0);
    this.lineChartEmpty = totalDays === 0 || maxValue <= 0;

    this.linePlotWidth = this.lineChartWidth - this.linePaddingX * 2;
    this.linePlotHeight = this.lineChartHeight - this.linePaddingTop - this.linePaddingBottom;
    this.lineGrid = [
      this.linePaddingTop,
      this.linePaddingTop + this.linePlotHeight / 2,
      this.linePaddingTop + this.linePlotHeight
    ];

    if (this.lineChartEmpty) {
      this.lineIncomePath = '';
      this.lineExpensePath = '';
      this.lineLabels = [];
      return;
    }

    const incomePoints = this.buildLinePoints(incomeSeries, totalDays, maxValue);
    const expensePoints = this.buildLinePoints(expenseSeries, totalDays, maxValue);
    this.lineIncomePath = this.buildLinePath(incomePoints);
    this.lineExpensePath = this.buildLinePath(expensePoints);
    this.lineLabels = this.buildLineLabels(totalDays, incomeSeries, expenseSeries);
  }

  private buildDonutChart() {
    const data = (this.contasSaldos ?? []).filter((account) => account.currentBalance > 0);
    const total = data.reduce((acc, cur) => acc + cur.currentBalance, 0);
    this.donutTotal = total;
    this.donutChartEmpty = data.length === 0 || total <= 0;

    if (this.donutChartEmpty) {
      this.donutSegments = [];
      return;
    }

    let angle = -Math.PI / 2;
    this.donutSegments = data.map((account, index) => {
      const value = account.currentBalance;
      const rawSlice = (value / total) * Math.PI * 2;
      const slice = Math.min(rawSlice, Math.PI * 2 - 0.0001);
      const start = angle;
      const end = angle + slice;
      angle = end;
      return {
        label: account.name || 'Conta',
        value,
        percent: (value / total) * 100,
        color: account.color || this.palette[index % this.palette.length],
        path: this.describeDonutArc(
          this.donutCenter,
          this.donutCenter,
          this.donutOuterRadius,
          this.donutInnerRadius,
          start,
          end
        )
      };
    });
  }

  private buildLinePoints(series: DailySerie[], totalDays: number, maxValue: number) {
    if (totalDays === 0 || series.length === 0) {
      return [];
    }
    return series.map((item, index) => {
      const x =
        totalDays === 1
          ? this.linePaddingX + this.linePlotWidth / 2
          : this.linePaddingX + (index / (totalDays - 1)) * this.linePlotWidth;
      const y =
        maxValue === 0
          ? this.linePaddingTop + this.linePlotHeight
          : this.linePaddingTop + (1 - item.total / maxValue) * this.linePlotHeight;
      return { x, y };
    });
  }

  private buildLinePath(points: Array<{ x: number; y: number }>) {
    if (points.length === 0) {
      return '';
    }
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  }

  private buildLineLabels(
    totalDays: number,
    incomeSeries: DailySerie[],
    expenseSeries: DailySerie[]
  ): LineLabel[] {
    if (totalDays === 0) {
      return [];
    }
    const midIndex = Math.floor((totalDays - 1) / 2);
    const indices = totalDays <= 2 ? [0, totalDays - 1] : [0, midIndex, totalDays - 1];
    const uniqueIndices = Array.from(new Set(indices.filter((idx) => idx >= 0)));

    return uniqueIndices.map((idx) => {
      const x =
        totalDays === 1
          ? this.linePaddingX + this.linePlotWidth / 2
          : this.linePaddingX + (idx / (totalDays - 1)) * this.linePlotWidth;
      const day = incomeSeries[idx]?.day ?? expenseSeries[idx]?.day ?? idx + 1;
      const text = day.toString().padStart(2, '0');
      return { x, text };
    });
  }

  private polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle)
    };
  }

  private describeDonutArc(
    cx: number,
    cy: number,
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    endAngle: number
  ) {
    const startOuter = this.polarToCartesian(cx, cy, outerRadius, endAngle);
    const endOuter = this.polarToCartesian(cx, cy, outerRadius, startAngle);
    const startInner = this.polarToCartesian(cx, cy, innerRadius, startAngle);
    const endInner = this.polarToCartesian(cx, cy, innerRadius, endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    return [
      `M ${startOuter.x} ${startOuter.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
      `L ${startInner.x} ${startInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
      'Z'
    ].join(' ');
  }
}
