const VIEWBOX_WIDTH = 920;
const VIEWBOX_HEIGHT = 290;
const PADDING = {
  top: 20,
  right: 16,
  bottom: 32,
  left: 38,
};

function isFinitePoint(point) {
  return Number.isFinite(Number(point?.t)) && Number.isFinite(Number(point?.tempF));
}

function clampRange(minValue, maxValue, fallbackSize = 1) {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return [0, fallbackSize];
  }

  if (minValue === maxValue) {
    return [minValue - fallbackSize, maxValue + fallbackSize];
  }

  return [minValue, maxValue];
}

function toScale(domainMin, domainMax, rangeMin, rangeMax) {
  const safeDomain = clampRange(domainMin, domainMax, 1);
  const [dMin, dMax] = safeDomain;
  const distance = dMax - dMin;

  return (value) => {
    const ratio = (value - dMin) / distance;
    return rangeMin + ((rangeMax - rangeMin) * ratio);
  };
}

function buildLinePath(points, toX, toY) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  return points.reduce((path, point, index) => {
    const command = index === 0 ? "M" : "L";
    return `${path}${command}${toX(point.t).toFixed(2)},${toY(point.tempF).toFixed(2)} `;
  }, "").trim();
}

function formatTempLabel(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}°F` : "--";
}

function formatTimeLabel(epochMs) {
  if (!Number.isFinite(Number(epochMs))) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochMs));
}

export default function TemperatureTimelineChart({
  title,
  subtitle,
  series,
  noDataLabel = "No temperature points in this range.",
}) {
  const normalizedSeries = (Array.isArray(series) ? series : [])
    .map((item, index) => ({
      key: item?.key ?? `series-${index}`,
      label: item?.label ?? "Series",
      color: item?.color ?? "#1f8b4d",
      strokeDasharray: item?.strokeDasharray ?? null,
      showDots: Boolean(item?.showDots),
      points: (Array.isArray(item?.points) ? item.points : [])
        .filter(isFinitePoint)
        .sort((a, b) => a.t - b.t),
    }))
    .filter((item) => item.points.length > 0);

  const allPoints = normalizedSeries.flatMap((item) => item.points);

  if (allPoints.length === 0) {
    return (
      <section className="panel">
        {title ? <p className="stat-label">{title}</p> : null}
        {subtitle ? <p className="muted" style={{ marginTop: 0 }}>{subtitle}</p> : null}
        <p className="muted" style={{ marginBottom: 0 }}>{noDataLabel}</p>
      </section>
    );
  }

  const minTime = Math.min(...allPoints.map((point) => point.t));
  const maxTime = Math.max(...allPoints.map((point) => point.t));
  const minTempRaw = Math.min(...allPoints.map((point) => point.tempF));
  const maxTempRaw = Math.max(...allPoints.map((point) => point.tempF));
  const minTemp = Math.floor(minTempRaw - 1);
  const maxTemp = Math.ceil(maxTempRaw + 1);

  const chartWidth = VIEWBOX_WIDTH - PADDING.left - PADDING.right;
  const chartHeight = VIEWBOX_HEIGHT - PADDING.top - PADDING.bottom;
  const toX = toScale(minTime, maxTime, PADDING.left, PADDING.left + chartWidth);
  const toY = toScale(minTemp, maxTemp, PADDING.top + chartHeight, PADDING.top);

  const horizontalGuideValues = Array.from({ length: 5 }, (_, index) => (
    minTemp + (((maxTemp - minTemp) * index) / 4)
  ));

  return (
    <section className="panel">
      {title ? <p className="stat-label">{title}</p> : null}
      {subtitle ? <p className="muted" style={{ marginTop: 0 }}>{subtitle}</p> : null}

      <div className="chart-legend">
        {normalizedSeries.map((item) => (
          <span key={item.key} className="chart-legend-item">
            <span className="chart-legend-swatch" style={{ background: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      <div className="temperature-chart-frame">
        <svg viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} role="img">
          <title>Temperature timeline</title>

          {horizontalGuideValues.map((value) => (
            <g key={value}>
              <line
                x1={PADDING.left}
                y1={toY(value)}
                x2={PADDING.left + chartWidth}
                y2={toY(value)}
                stroke="#d9dde3"
                strokeWidth="1"
              />
              <text
                x={PADDING.left - 8}
                y={toY(value) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#536070"
              >
                {Math.round(value)}
              </text>
            </g>
          ))}

          {normalizedSeries.map((item) => (
            <g key={item.key}>
              {item.points.length > 1 && (
                <path
                  d={buildLinePath(item.points, toX, toY)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2.4"
                  strokeDasharray={item.strokeDasharray ?? undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {(item.showDots || item.points.length === 1) &&
                item.points.map((point) => (
                  <circle
                    key={`${item.key}-${point.t}-${point.tempF}`}
                    cx={toX(point.t)}
                    cy={toY(point.tempF)}
                    r="3.1"
                    fill={item.color}
                  >
                    <title>
                      {`${item.label}: ${formatTempLabel(point.tempF)} @ ${formatTimeLabel(point.t)}`}
                    </title>
                  </circle>
                ))}
            </g>
          ))}

          <text
            x={PADDING.left}
            y={VIEWBOX_HEIGHT - 10}
            fontSize="11"
            fill="#536070"
          >
            {formatTimeLabel(minTime)}
          </text>
          <text
            x={PADDING.left + chartWidth}
            y={VIEWBOX_HEIGHT - 10}
            textAnchor="end"
            fontSize="11"
            fill="#536070"
          >
            {formatTimeLabel(maxTime)}
          </text>
        </svg>
      </div>
    </section>
  );
}
