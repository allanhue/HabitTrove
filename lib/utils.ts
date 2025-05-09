import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { DateTime, DateTimeFormatOptions } from "luxon"
import { datetime, RRule } from 'rrule'
import { Freq, Habit, CoinTransaction, Permission } from '@/lib/types'
import { DUE_MAP, INITIAL_DUE, INITIAL_RECURRENCE_RULE, RECURRENCE_RULE_MAP } from "./constants"
import * as chrono from 'chrono-node'
import _ from "lodash"
import { v4 as uuidv4 } from 'uuid'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// get today's date string for timezone
export function getTodayInTimezone(timezone: string): string {
  const now = getNow({ timezone });
  return getISODate({ dateTime: now, timezone });
}

export function getISODate({ dateTime, timezone }: { dateTime: DateTime, timezone: string }): string {
  return dateTime.setZone(timezone).toISODate()!;
}

// get datetime object of now
export function getNow({ timezone = 'utc', keepLocalTime }: { timezone?: string, keepLocalTime?: boolean }) {
  return DateTime.now().setZone(timezone, { keepLocalTime });
}

// get current time in epoch milliseconds
export function getNowInMilliseconds() {
  const now = getNow({});
  return d2n({ dateTime: now });
}

// iso timestamp to datetime object, most for storage read
export function t2d({ timestamp, timezone }: { timestamp: string; timezone: string }) {
  return DateTime.fromISO(timestamp).setZone(timezone);
}

// convert datetime object to iso timestamp, mostly for storage write (be sure to use default utc timezone when writing)
export function d2t({ dateTime, timezone = 'utc' }: { dateTime: DateTime, timezone?: string }) {
  return dateTime.setZone(timezone).toISO()!;
}

// convert datetime object to string, mostly for display
export function d2s({ dateTime, format, timezone }: { dateTime: DateTime, format?: string | DateTimeFormatOptions, timezone: string }) {
  if (format) {
    if (typeof format === 'string') {
      return dateTime.setZone(timezone).toFormat(format);
    } else {
      return dateTime.setZone(timezone).toLocaleString(format);
    }
  }
  return dateTime.setZone(timezone).toLocaleString(DateTime.DATETIME_MED);
}

// convert datetime object to date string, mostly for display
export function d2sDate({ dateTime }: { dateTime: DateTime }) {
  return dateTime.toLocaleString(DateTime.DATE_MED);
}

// convert datetime object to epoch milliseconds string, mostly for storage write
export function d2n({ dateTime }: { dateTime: DateTime }) {
  return dateTime.toMillis().toString();
}

// compare the date portion of two datetime objects (i.e. same year, month, day)
export function isSameDate(a: DateTime, b: DateTime) {
  return a.hasSame(b, 'day');
}

export function normalizeCompletionDate(date: string, timezone: string): string {
  // If already in ISO format, return as is
  if (date.includes('T')) {
    return date;
  }
  // Convert from yyyy-MM-dd to ISO format
  return DateTime.fromFormat(date, 'yyyy-MM-dd', { zone: timezone }).toUTC().toISO()!;
}

export function getCompletionsForDate({
  habit,
  date,
  timezone
}: {
  habit: Habit,
  date: DateTime | string,
  timezone: string
}): number {
  const dateObj = typeof date === 'string' ? DateTime.fromISO(date) : date
  return habit.completions.filter((completion: string) =>
    isSameDate(t2d({ timestamp: completion, timezone }), dateObj)
  ).length
}

export function getCompletionsForToday({
  habit,
  timezone
}: {
  habit: Habit,
  timezone: string
}): number {
  return getCompletionsForDate({ habit, date: getTodayInTimezone(timezone), timezone })
}

export function getCompletedHabitsForDate({
  habits,
  date,
  timezone
}: {
  habits: Habit[],
  date: DateTime | string,
  timezone: string
}): Habit[] {
  return habits.filter(habit => {
    const completionsToday = getCompletionsForDate({ habit, date, timezone })
    const target = habit.targetCompletions || 1
    return completionsToday >= target
  })
}

export function getHabitProgress({
  habit,
  timezone
}: {
  habit: Habit,
  timezone: string
}): number {
  const today = getTodayInTimezone(timezone)
  const completionsToday = getCompletionsForDate({ habit, date: today, timezone })
  const target = habit.targetCompletions || 1
  return Math.min(100, (completionsToday / target) * 100)
}

export function calculateCoinsEarnedToday(transactions: CoinTransaction[], timezone: string): number {
  const today = getTodayInTimezone(timezone);
  return transactions
    .filter(transaction =>
      isSameDate(t2d({ timestamp: transaction.timestamp, timezone }),
        t2d({ timestamp: today, timezone })) &&
      (transaction.amount > 0 || transaction.type === 'HABIT_UNDO')
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function calculateTotalEarned(transactions: CoinTransaction[]): number {
  return transactions
    .filter(transaction =>
      transaction.amount > 0 || transaction.type === 'HABIT_UNDO'
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
}

export function calculateTotalSpent(transactions: CoinTransaction[]): number {
  return Math.abs(
    transactions
      .filter(transaction =>
        transaction.amount < 0 &&
        transaction.type !== 'HABIT_UNDO'
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0)
  );
}

export function calculateCoinsSpentToday(transactions: CoinTransaction[], timezone: string): number {
  const today = getTodayInTimezone(timezone);
  return Math.abs(
    transactions
      .filter(transaction =>
        isSameDate(t2d({ timestamp: transaction.timestamp, timezone }),
          t2d({ timestamp: today, timezone })) &&
        transaction.amount < 0 &&
        transaction.type !== 'HABIT_UNDO'
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0)
  );
}

export function calculateTransactionsToday(transactions: CoinTransaction[], timezone: string): number {
  const today = getTodayInTimezone(timezone);
  return transactions.filter(t =>
    isSameDate(t2d({ timestamp: t.timestamp, timezone }),
      t2d({ timestamp: today, timezone }))
  ).length;
}

export function getRRuleUTC(recurrenceRule: string) {
  return RRule.fromString(recurrenceRule); // this returns UTC
}

export function parseNaturalLanguageRRule(ruleText: string) {
  ruleText = ruleText.trim()
  let rrule: RRule
  if (RECURRENCE_RULE_MAP[ruleText]) {
    rrule = RRule.fromString(RECURRENCE_RULE_MAP[ruleText])
  } else {
    rrule = RRule.fromText(ruleText)
  }

  if (isUnsupportedRRule(rrule)) return RRule.fromString('invalid') // return invalid if unsupported
  return rrule
}

export function parseRRule(ruleText: string) {
  ruleText = ruleText.trim()
  let rrule: RRule
  if (RECURRENCE_RULE_MAP[ruleText]) {
    rrule = RRule.fromString(RECURRENCE_RULE_MAP[ruleText])
  } else {
    rrule = RRule.fromString(ruleText)
  }

  if (isUnsupportedRRule(rrule)) return RRule.fromString('invalid') // return invalid if unsupported
  return rrule
}

export function serializeRRule(rrule: RRule) {
  return rrule.toString()
}

export function parseNaturalLanguageDate({ text, timezone }: { text: string, timezone: string }) {
  if (DUE_MAP[text]) {
    text = DUE_MAP[text]
  }
  const now = getNow({ timezone })
  const due = chrono.parseDate(text, { instant: now.toJSDate(), timezone })
  if (!due) throw Error('invalid rule')
  // return d2s({ dateTime: DateTime.fromJSDate(due), timezone, format: DateTime.DATE_MED_WITH_WEEKDAY })
  return DateTime.fromJSDate(due).setZone(timezone)
}

export function getFrequencyDisplayText(frequency: string | undefined, isRecurRule: boolean, timezone: string) {
  if (isRecurRule) {
    try {
      return parseRRule((frequency) || INITIAL_RECURRENCE_RULE).toText();
    } catch {
      return 'invalid'
    }
  } else {
    if (!frequency) {
      return INITIAL_DUE
    }
    return d2s({
      dateTime: t2d({ timestamp: frequency, timezone: timezone }),
      timezone: timezone, 
      format: DateTime.DATE_MED_WITH_WEEKDAY
    });
  }
}

export function isHabitDue({
  habit,
  timezone,
  date
}: {
  habit: Habit
  timezone: string
  date: DateTime
}): boolean {
  // handle task
  if (habit.isTask) {
    // For tasks, frequency is stored as a UTC ISO timestamp
    const taskDueDate = t2d({ timestamp: habit.frequency, timezone })
    return isSameDate(taskDueDate, date);
  }

  // handle habit
  if (habit.archived) {
    return false
  }

  const startOfDay = date.setZone(timezone).startOf('day')
  const endOfDay = date.setZone(timezone).endOf('day')

  const ruleText = habit.frequency
  let rrule
  try {
    rrule = parseRRule(ruleText)
  } catch (error) {
    console.error(`Failed to parse rrule for habit: ${habit.id} ${habit.name}`)
    return false
  }
  rrule.origOptions.tzid = timezone
  rrule.options.tzid = rrule.origOptions.tzid
  rrule.origOptions.dtstart = datetime(startOfDay.year, startOfDay.month, startOfDay.day, startOfDay.hour, startOfDay.minute, startOfDay.second)
  rrule.options.dtstart = rrule.origOptions.dtstart
  rrule.origOptions.count = 1
  rrule.options.count = rrule.origOptions.count

  const matches = rrule.all()
  if (!matches.length) return false
  const t = DateTime.fromJSDate(matches[0]).toUTC().setZone('local', { keepLocalTime: true }).setZone(timezone)
  return startOfDay <= t && t <= endOfDay
}

export function isHabitCompleted(habit: Habit, timezone: string): boolean {
  return getCompletionsForToday({ habit, timezone: timezone }) >= (habit.targetCompletions || 1)
}

export function isTaskOverdue(habit: Habit, timezone: string): boolean {
  if (!habit.isTask || habit.archived) return false
  const dueDate = t2d({ timestamp: habit.frequency, timezone }).startOf('day')
  const now = getNow({ timezone }).startOf('day')
  return dueDate < now && !isHabitCompleted(habit, timezone)
}

export function isHabitDueToday({
  habit,
  timezone
}: {
  habit: Habit
  timezone: string
}): boolean {
  const today = getNow({ timezone })
  return isHabitDue({ habit, timezone, date: today })
}

export function getHabitFreq(habit: Habit): Freq {
  if (habit.isTask) {
    // don't support recurring task yet
    return 'daily'
  }
  const rrule = parseRRule(habit.frequency)
  const freq = rrule.origOptions.freq
  switch (freq) {
    case RRule.DAILY: return 'daily'
    case RRule.WEEKLY: return 'weekly'
    case RRule.MONTHLY: return 'monthly'
    case RRule.YEARLY: return 'yearly'

    default:
      console.error(`Invalid frequency: ${freq} (habit: ${habit.id} ${habit.name}) (rrule: ${rrule.toString()}). Defaulting to daily`)
      return 'daily'
  }
}

export function isUnsupportedRRule(rrule: RRule): boolean {
  const freq = rrule.origOptions.freq
  return freq === RRule.HOURLY || freq === RRule.MINUTELY || freq === RRule.SECONDLY
}

// play sound (client side only, must be run in browser)
export const playSound = (soundPath: string = '/sounds/timer-end.wav') => {
  const audio = new Audio(soundPath)
  audio.play().catch(error => {
    console.error('Error playing sound:', error)
  })
}

// open a new window (client side only, must be run in browser)
export const openWindow = (url: string): boolean => {
  const newWindow = window.open(url, '_blank')
  if (newWindow === null) {
    // Popup was blocked
    return false
  }
  return true
}

export function deepMerge<T>(a: T, b: T) {
  return _.merge(a, b, (x: unknown, y: unknown) => {
      if (_.isArray(a)) {
        return a.concat(b)
      }
    })
}

export function checkPermission(
  permissions: Permission[] | undefined,
  resource: 'habit' | 'wishlist' | 'coins',
  action: 'write' | 'interact'
): boolean {
  if (!permissions) return false
  
  return permissions.some(permission => {
    switch (resource) {
      case 'habit':
        return permission.habit[action]
      case 'wishlist':
        return permission.wishlist[action]
      case 'coins':
        return permission.coins[action]
      default:
        return false
    }
  })
}

export function uuid() {
  return uuidv4()
}
