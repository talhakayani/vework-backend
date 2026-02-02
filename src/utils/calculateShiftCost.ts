import { differenceInHours, parse } from 'date-fns';

export const calculateShiftCost = (
  startTime: string,
  endTime: string,
  baseHourlyRate: number,
  platformFeePercentage: number,
  requiredEmployees: number
): { baseAmount: number; platformFee: number; totalCost: number } => {
  // Parse time strings (format: "HH:mm")
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);

  // Calculate hours
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  const totalMinutes = endMinutes - startMinutes;
  const hours = totalMinutes / 60;

  // Calculate costs
  const baseAmount = hours * baseHourlyRate * requiredEmployees;
  const platformFee = (baseAmount * platformFeePercentage) / 100;
  const totalCost = baseAmount + platformFee;

  return {
    baseAmount: Math.round(baseAmount * 100) / 100,
    platformFee: Math.round(platformFee * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
};

export const calculatePenalty = (
  totalCost: number,
  penaltyPercentage: number
): number => {
  return Math.round((totalCost * penaltyPercentage) / 100 * 100) / 100;
};

export const getHoursFromShift = (startTime: string, endTime: string): number => {
  const [startHour, startMin] = startTime.split(':').map(Number);
  const [endHour, endMin] = endTime.split(':').map(Number);
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  return (endMinutes - startMinutes) / 60;
};
