"use client";

import { HouseholdContext, useHouseholdState } from "@/lib/useHousehold";

export default function HouseholdProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useHouseholdState();
  return (
    <HouseholdContext.Provider value={value}>
      {children}
    </HouseholdContext.Provider>
  );
}
