// 登入身分（mock）。avatar 底色取自設計 token 色相，彼此可辨識。
import type { User } from "@/types/domain";

export const USERS: User[] = [
  {
    id: "u-christian",
    name: "Christian Wu",
    initials: "CW",
    role: "負責人",
    color: "#0099ff",
  },
  {
    id: "u-david",
    name: "David Wu",
    initials: "DW",
    role: "業務",
    color: "#7c6bff",
  },
  {
    id: "u-aaron",
    name: "Aaron Lin",
    initials: "AL",
    role: "估價",
    color: "#22c55e",
  },
  {
    id: "u-jamie",
    name: "Jamie Tsai",
    initials: "JT",
    role: "工務",
    color: "#f5a623",
  },
  {
    id: "u-yvonne",
    name: "Yvonne Chen",
    initials: "YC",
    role: "行政",
    color: "#ff5577",
  },
];

export const userById = (id?: string): User | undefined =>
  id ? USERS.find((u) => u.id === id) : undefined;
