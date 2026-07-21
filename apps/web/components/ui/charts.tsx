"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

/** Tiny sparkline for stat cards. */
export function Sparkline({
  data,
  color,
  height = 48,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data.map((v) => ({ v }))} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${id})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Platform Overview: dual-series area chart (earnings + payouts). */
export function AreaTrend({
  data,
}: {
  data: { label: string; earnings: number; payouts: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="earn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#12b76a" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#12b76a" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="pay" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "#94a3b8", fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tick={{ fill: "#94a3b8", fontSize: 12 }}
          tickFormatter={(v) => `$${v / 1000}K`}
          ticks={[0, 2000, 4000, 6000, 8000, 10000]}
        />
        <Area type="monotone" dataKey="earnings" stroke="#12b76a" strokeWidth={2.5} fill="url(#earn)" dot={false} />
        <Area type="monotone" dataKey="payouts" stroke="#3b82f6" strokeWidth={2.5} fill="url(#pay)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Fraud & Risk: single red line chart. */
export function LineTrend({
  data,
}: {
  data: { label: string; v: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={170}>
      <LineChart data={data} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="fraudfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} ticks={[0, 250, 500, 750]} />
        <Area type="monotone" dataKey="v" stroke="none" fill="url(#fraudfill)" />
        <Line type="monotone" dataKey="v" stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 3, fill: "#f43f5e" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Users Overview donut. */
export function Donut({
  data,
  centerTop,
  centerBottom,
}: {
  data: { name: string; value: number; color: string }[];
  centerTop: string;
  centerBottom: string;
}) {
  return (
    <div className="relative h-[200px] w-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius={66}
            outerRadius={92}
            paddingAngle={2}
            stroke="none"
            startAngle={90}
            endAngle={-270}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-slate-900">{centerTop}</span>
        <span className="text-xs text-slate-400">{centerBottom}</span>
      </div>
    </div>
  );
}
