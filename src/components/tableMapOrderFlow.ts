export interface TableMapShiftState {
  hasActiveShift: boolean;
  activeShiftZones?: string[];
  activeShiftZone?: string;
}

export function hasActiveShiftForZone(zone: string, shiftState: TableMapShiftState): boolean {
  const restrictedZones = shiftState.activeShiftZones && shiftState.activeShiftZones.length > 0
    ? shiftState.activeShiftZones
    : (shiftState.activeShiftZone ? [shiftState.activeShiftZone] : []);

  return shiftState.hasActiveShift && (
    restrictedZones.length === 0 || restrictedZones.includes(zone)
  );
}

export function shouldOpenOrderOnTableSelect(
  zone: string,
  isEditMode: boolean,
  shiftState: TableMapShiftState
): boolean {
  return !isEditMode && hasActiveShiftForZone(zone, shiftState);
}
