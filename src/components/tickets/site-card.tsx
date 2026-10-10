import { Home } from "lucide-react";
import { Field, FieldGrid, Section } from "@/components/layout";
import { AddressLink, PhoneLink } from "./contact-links";
import type { EngineerTicketRow } from "@/lib/types";

export type SiteDetails = Pick<
  EngineerTicketRow,
  | "client_name"
  | "client_phone"
  | "address"
  | "plant_capacity"
  | "consumer_number"
  | "kseb_section"
>;

/**
 * Everything an engineer needs to reach and identify the site: who to call,
 * where to go, and the plant/KSEB references to quote on arrival.
 */
export function SiteCard({ site }: { site: SiteDetails }) {
  return (
    <Section title="Site" icon={Home}>
      <FieldGrid cols={2}>
        <Field label="Client" value={site.client_name} />
        <Field label="Phone" value={<PhoneLink phone={site.client_phone} />} />
        <Field
          label="Address"
          value={<AddressLink address={site.address} />}
          className="sm:col-span-2"
        />
        <Field label="Plant capacity" value={site.plant_capacity} />
        <Field label="Consumer no." value={site.consumer_number} />
        <Field label="KSEB section" value={site.kseb_section} />
      </FieldGrid>
    </Section>
  );
}
