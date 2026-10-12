// สถานะของแอป (ผู้ใช้ที่ล็อกอิน สาย ธนาคาร ตัวกรอง)

export const state = { me: null, lines: [], banks: [], bankMap: {}, lineFilter: "", timer: null, renderId: 0 };

export const app = document.getElementById("app");
