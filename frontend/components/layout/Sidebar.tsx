"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  {
    name: "Dashboard",
    href: "/dashboard",
  },
  {
    name: "Brands",
    href: "/brands",
  },
  {
    name: "Channels",
    href: "/channels",
  },
  {
    name: "Studio",
    href: "/studio",
  },
  {
    name: "AI Agents",
    href: "/agents",
  },
  {
    name: "Analytics",
    href: "/analytics",
  },
  {
    name: "Settings",
    href: "/settings",
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-white border-r min-h-screen p-6">
      <h2 className="text-xl font-bold mb-8">
        CreatorOS
      </h2>

      <nav>
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const active = pathname === item.href;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-lg px-4 py-3 transition ${
                    active
                      ? "bg-blue-600 text-white"
                      : "hover:bg-gray-100"
                  }`}
                >
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}   