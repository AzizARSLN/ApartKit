/** UI labels for domain status codes (API still uses English codes). */

export function chargeStatusLabel(status: string): string {
  switch (status) {
    case "OPEN":
      return "Açık";
    case "PARTIAL":
      return "Kısmi";
    case "PAID":
      return "Ödendi";
    case "CANCELLED":
      return "İptal";
    case "CARRIED_FORWARD":
      return "Devredildi";
    default:
      return status;
  }
}

export function paymentStatusLabel(status: string): string {
  switch (status) {
    case "POSTED":
      return "İşlendi";
    case "REVERSED":
      return "İade";
    case "PAID":
      return "Ödendi";
    case "PARTIAL":
      return "Kısmi";
    case "OPEN":
      return "Açık";
    case "UNPAID":
      return "Ödenmedi";
    default:
      return status;
  }
}

export function expenseStatusLabel(status: string): string {
  switch (status) {
    case "POSTED":
      return "İşlendi";
    case "CANCELLED":
      return "İptal";
    case "DRAFT":
      return "Taslak";
    default:
      return status;
  }
}

export function bankMatchStatusLabel(status: string): string {
  switch (status) {
    case "UNMATCHED":
      return "Eşleşmedi";
    case "SUGGESTED":
      return "Önerildi";
    case "REVIEW_REQUIRED":
      return "Kontrol";
    case "MATCHED":
      return "Tahsil edildi";
    case "IGNORED":
      return "Yoksayıldı";
    case "EXPENSE":
      return "Gider";
    default:
      return status;
  }
}

export function unitStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Aktif";
    case "INACTIVE":
      return "Pasif";
    default:
      return status;
  }
}

export function ticketStatusLabel(status: string): string {
  switch (status) {
    case "OPEN":
      return "Açık";
    case "IN_PROGRESS":
      return "Devam ediyor";
    case "RESOLVED":
      return "Çözüldü";
    case "CLOSED":
      return "Kapalı";
    default:
      return status;
  }
}
