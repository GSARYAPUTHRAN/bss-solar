"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Coordinator {
  id: string;
  full_name: string;
}

export function CoordinatorSelect({
  name,
  coordinators,
  defaultValue,
  includeSelf,
  placeholder = "Select coordinator",
  id,
  "aria-label": ariaLabel,
}: {
  name: string;
  coordinators: Coordinator[];
  defaultValue?: string;
  includeSelf?: Coordinator;
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const list = [...coordinators];
  if (includeSelf && !list.some((c) => c.id === includeSelf.id)) {
    list.unshift(includeSelf);
  }

  return (
    <Select name={name} defaultValue={defaultValue}>
      <SelectTrigger id={id} aria-label={ariaLabel ?? placeholder} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {list.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
