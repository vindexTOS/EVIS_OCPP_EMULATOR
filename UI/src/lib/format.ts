export const fmtEnergy = (wh: number) =>
  wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${Math.round(wh)} Wh`;

export const fmtPower = (w: number) =>
  w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;

export const soc = (current: number, capacity: number) =>
  capacity > 0 ? Math.round((100 * current) / capacity) : 0;
