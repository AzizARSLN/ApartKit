import { z } from "zod";
import { AppError } from "../errors/app-error.js";

export const MoneyStringSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Amount must be a decimal string with up to 2 fraction digits");

/** Fixed-scale money (2 decimal places) using integer minor units. */
export class Money {
  private constructor(private readonly minor: bigint) {}

  static zero(): Money {
    return new Money(0n);
  }

  static from(value: string | number | Money): Money {
    if (value instanceof Money) return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) {
        throw new AppError("INVALID_AMOUNT", "Geçersiz tutar.", 400);
      }
      return Money.from(value.toFixed(2));
    }

    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      throw new AppError("INVALID_AMOUNT", "Geçersiz tutar.", 400);
    }

    const [whole, fraction = ""] = value.split(".");
    const frac = (fraction + "00").slice(0, 2);
    return new Money(BigInt(whole) * 100n + BigInt(frac));
  }

  static min(a: Money, b: Money): Money {
    return a.minor <= b.minor ? a : b;
  }

  plus(other: Money): Money {
    return new Money(this.minor + other.minor);
  }

  minus(other: Money): Money {
    return new Money(this.minor - other.minor);
  }

  mulRatio(numerator: Money, denominator: Money): Money {
    if (denominator.minor === 0n) {
      throw new AppError("INVALID_AMOUNT", "Sıfıra bölme.", 400);
    }
    // (this * numerator) / denominator with half-up rounding
    const raw = this.minor * numerator.minor;
    const den = denominator.minor;
    const q = raw / den;
    const r = raw % den;
    const rounded = r * 2n >= den ? q + 1n : q;
    return new Money(rounded);
  }

  eq(other: Money): boolean {
    return this.minor === other.minor;
  }

  lt(other: Money): boolean {
    return this.minor < other.minor;
  }

  lte(other: Money): boolean {
    return this.minor <= other.minor;
  }

  gt(other: Money): boolean {
    return this.minor > other.minor;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  toFixed(): string {
    const sign = this.minor < 0n ? "-" : "";
    const abs = this.minor < 0n ? -this.minor : this.minor;
    const whole = abs / 100n;
    const frac = abs % 100n;
    return `${sign}${whole.toString()}.${frac.toString().padStart(2, "0")}`;
  }
}

/** @deprecated alias — prefer Money.from */
export function money(value: string | number | Money): Money {
  const m = Money.from(value);
  if (m.isNegative()) {
    throw new AppError("INVALID_AMOUNT", "Geçersiz tutar.", 400);
  }
  return m;
}

export function moneyToString(value: Money): string {
  return value.toFixed();
}

export function assertMoneyEq(a: Money, b: Money, code = "AMOUNT_MISMATCH"): void {
  if (!a.eq(b)) {
    throw new AppError(code, "Tutarlar eşleşmiyor.", 400, {
      left: moneyToString(a),
      right: moneyToString(b),
    });
  }
}

/** Compatibility export used by older call sites expecting Decimal-like API */
export const Decimal = {
  min: Money.min,
};
