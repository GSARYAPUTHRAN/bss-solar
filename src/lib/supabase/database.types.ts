export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          dedupe_key: string | null;
          id: string;
          link: string | null;
          read_at: string | null;
          recipient_id: string;
          title: string;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string | null;
          created_at?: string;
          dedupe_key?: string | null;
          id?: string;
          link?: string | null;
          read_at?: string | null;
          recipient_id: string;
          title: string;
          type: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          dedupe_key?: string | null;
          id?: string;
          link?: string | null;
          read_at?: string | null;
          recipient_id?: string;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          method: Database["public"]["Enums"]["payment_method"];
          notes: string | null;
          paid_on: string;
          purpose: Database["public"]["Enums"]["payment_purpose"];
          recorded_by: string | null;
          reference: string | null;
          updated_at: string;
          work_order_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          paid_on: string;
          purpose?: Database["public"]["Enums"]["payment_purpose"];
          recorded_by?: string | null;
          reference?: string | null;
          updated_at?: string;
          work_order_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          paid_on?: string;
          purpose?: Database["public"]["Enums"]["payment_purpose"];
          recorded_by?: string | null;
          reference?: string | null;
          updated_at?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders_list";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          full_name: string;
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          full_name: string;
          id: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Update: {
          created_at?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
        };
        Relationships: [];
      };
      project_milestones: {
        Row: {
          completed_at: string | null;
          id: string;
          notes: string | null;
          project_id: string;
          sort_order: number;
          stage: Database["public"]["Enums"]["project_stage"];
          status: Database["public"]["Enums"]["milestone_status"];
        };
        ComputedFields: never;
        Insert: {
          completed_at?: string | null;
          id?: string;
          notes?: string | null;
          project_id: string;
          sort_order: number;
          stage: Database["public"]["Enums"]["project_stage"];
          status?: Database["public"]["Enums"]["milestone_status"];
        };
        Update: {
          completed_at?: string | null;
          id?: string;
          notes?: string | null;
          project_id?: string;
          sort_order?: number;
          stage?: Database["public"]["Enums"]["project_stage"];
          status?: Database["public"]["Enums"]["milestone_status"];
        };
        Relationships: [
          {
            foreignKeyName: "project_milestones_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_milestones_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects_list";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_milestones_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "work_orders_list";
            referencedColumns: ["project_id"];
          },
        ];
      };
      projects: {
        Row: {
          completed_at: string | null;
          coordinator_id: string;
          coordinator_incentive: number | null;
          created_at: string;
          current_stage: Database["public"]["Enums"]["project_stage"];
          feasibility_date: string | null;
          id: string;
          incentive_paid_on: string | null;
          is_completed: boolean;
          started_at: string;
          updated_at: string;
          work_order_id: string;
        };
        ComputedFields: never;
        Insert: {
          completed_at?: string | null;
          coordinator_id: string;
          coordinator_incentive?: number | null;
          created_at?: string;
          current_stage?: Database["public"]["Enums"]["project_stage"];
          feasibility_date?: string | null;
          id?: string;
          incentive_paid_on?: string | null;
          is_completed?: boolean;
          started_at?: string;
          updated_at?: string;
          work_order_id: string;
        };
        Update: {
          completed_at?: string | null;
          coordinator_id?: string;
          coordinator_incentive?: number | null;
          created_at?: string;
          current_stage?: Database["public"]["Enums"]["project_stage"];
          feasibility_date?: string | null;
          id?: string;
          incentive_paid_on?: string | null;
          is_completed?: boolean;
          started_at?: string;
          updated_at?: string;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: true;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: true;
            referencedRelation: "work_orders_list";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_seen_at: string;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_seen_at?: string;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_seen_at?: string;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      service_tickets: {
        Row: {
          action_taken: string | null;
          amc_charge: number | null;
          assigned_to: string | null;
          bat_bank_nos: number | null;
          bat_capacity_ah: string | null;
          bat_make: string | null;
          bat_model: string | null;
          bat_qty: number | null;
          battery_voltage: string | null;
          battery_water_level: string | null;
          charging_current: string | null;
          cost_of_spares: number | null;
          created_at: string;
          created_by: string | null;
          defects_found: string | null;
          id: string;
          mppt_readings: Json | null;
          nature_of_complaint: string | null;
          project_id: string | null;
          scheduled_date: string | null;
          service_charge: number | null;
          service_date: string | null;
          spv_make: string | null;
          spv_module_capacity: string | null;
          spv_no_of_strings: number | null;
          spv_string_readings: Json | null;
          spv_total_nos: number | null;
          spv_total_watts: number | null;
          spv_voc: string | null;
          status: Database["public"]["Enums"]["ticket_status"];
          sys_capacity: string | null;
          sys_loading_capacity: string | null;
          sys_make: string | null;
          sys_model: string | null;
          sys_serial_no: string | null;
          ticket_no: string | null;
          ticket_type: Database["public"]["Enums"]["ticket_type"];
          total: number | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          action_taken?: string | null;
          amc_charge?: number | null;
          assigned_to?: string | null;
          bat_bank_nos?: number | null;
          bat_capacity_ah?: string | null;
          bat_make?: string | null;
          bat_model?: string | null;
          bat_qty?: number | null;
          battery_voltage?: string | null;
          battery_water_level?: string | null;
          charging_current?: string | null;
          cost_of_spares?: number | null;
          created_at?: string;
          created_by?: string | null;
          defects_found?: string | null;
          id?: string;
          mppt_readings?: Json | null;
          nature_of_complaint?: string | null;
          project_id?: string | null;
          scheduled_date?: string | null;
          service_charge?: number | null;
          service_date?: string | null;
          spv_make?: string | null;
          spv_module_capacity?: string | null;
          spv_no_of_strings?: number | null;
          spv_string_readings?: Json | null;
          spv_total_nos?: number | null;
          spv_total_watts?: number | null;
          spv_voc?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          sys_capacity?: string | null;
          sys_loading_capacity?: string | null;
          sys_make?: string | null;
          sys_model?: string | null;
          sys_serial_no?: string | null;
          ticket_no?: string | null;
          ticket_type?: Database["public"]["Enums"]["ticket_type"];
          total?: number | null;
          updated_at?: string;
        };
        Update: {
          action_taken?: string | null;
          amc_charge?: number | null;
          assigned_to?: string | null;
          bat_bank_nos?: number | null;
          bat_capacity_ah?: string | null;
          bat_make?: string | null;
          bat_model?: string | null;
          bat_qty?: number | null;
          battery_voltage?: string | null;
          battery_water_level?: string | null;
          charging_current?: string | null;
          cost_of_spares?: number | null;
          created_at?: string;
          created_by?: string | null;
          defects_found?: string | null;
          id?: string;
          mppt_readings?: Json | null;
          nature_of_complaint?: string | null;
          project_id?: string | null;
          scheduled_date?: string | null;
          service_charge?: number | null;
          service_date?: string | null;
          spv_make?: string | null;
          spv_module_capacity?: string | null;
          spv_no_of_strings?: number | null;
          spv_string_readings?: Json | null;
          spv_total_nos?: number | null;
          spv_total_watts?: number | null;
          spv_voc?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          sys_capacity?: string | null;
          sys_loading_capacity?: string | null;
          sys_make?: string | null;
          sys_model?: string | null;
          sys_serial_no?: string | null;
          ticket_no?: string | null;
          ticket_type?: Database["public"]["Enums"]["ticket_type"];
          total?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_tickets_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_tickets_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects_list";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "work_orders_list";
            referencedColumns: ["project_id"];
          },
        ];
      };
      work_orders: {
        Row: {
          address: string | null;
          advance_amount: number | null;
          client_name: string;
          client_phone: string | null;
          consumer_number: string | null;
          coordinator_id: string;
          created_at: string;
          financing_type: Database["public"]["Enums"]["financing_type"];
          first_payment_amount: number | null;
          first_payment_date: string | null;
          id: string;
          kseb_section: string | null;
          loan_bank_name: string | null;
          notes: string | null;
          order_date: string;
          plant_capacity: string;
          plant_capacity_kw: number | null;
          second_payment_amount: number | null;
          second_payment_date: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          total_cost: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          advance_amount?: number | null;
          client_name: string;
          client_phone?: string | null;
          consumer_number?: string | null;
          coordinator_id: string;
          created_at?: string;
          financing_type?: Database["public"]["Enums"]["financing_type"];
          first_payment_amount?: number | null;
          first_payment_date?: string | null;
          id?: string;
          kseb_section?: string | null;
          loan_bank_name?: string | null;
          notes?: string | null;
          order_date?: string;
          plant_capacity: string;
          plant_capacity_kw?: never;
          second_payment_amount?: number | null;
          second_payment_date?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          total_cost?: number;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          advance_amount?: number | null;
          client_name?: string;
          client_phone?: string | null;
          consumer_number?: string | null;
          coordinator_id?: string;
          created_at?: string;
          financing_type?: Database["public"]["Enums"]["financing_type"];
          first_payment_amount?: number | null;
          first_payment_date?: string | null;
          id?: string;
          kseb_section?: string | null;
          loan_bank_name?: string | null;
          notes?: string | null;
          order_date?: string;
          plant_capacity?: string;
          plant_capacity_kw?: never;
          second_payment_amount?: number | null;
          second_payment_date?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          total_cost?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      projects_list: {
        Row: {
          address: string | null;
          advance_amount: number | null;
          amount_received: number | null;
          balance_due: number | null;
          client_name: string | null;
          client_phone: string | null;
          completed_at: string | null;
          consumer_number: string | null;
          coordinator_id: string | null;
          coordinator_incentive: number | null;
          coordinator_name: string | null;
          created_at: string | null;
          current_stage: Database["public"]["Enums"]["project_stage"] | null;
          feasibility_date: string | null;
          feasibility_days_left: number | null;
          feasibility_extension_cost: number | null;
          feasibility_periods: number | null;
          feasibility_renewals: number | null;
          feasibility_valid_until: string | null;
          financing_type: Database["public"]["Enums"]["financing_type"] | null;
          id: string | null;
          incentive_paid_on: string | null;
          is_completed: boolean | null;
          kseb_section: string | null;
          last_payment_on: string | null;
          loan_bank_name: string | null;
          milestones_done: number | null;
          milestones_total: number | null;
          payment_count: number | null;
          payment_pending: boolean | null;
          payments_total: number | null;
          plant_capacity: string | null;
          plant_capacity_kw: number | null;
          started_at: string | null;
          total_cost: number | null;
          work_order_id: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "projects_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: true;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projects_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: true;
            referencedRelation: "work_orders_list";
            referencedColumns: ["id"];
          },
        ];
      };
      service_tickets_list: {
        Row: {
          assigned_to: string | null;
          assignee_name: string | null;
          client_name: string | null;
          created_at: string | null;
          id: string | null;
          project_id: string | null;
          scheduled_date: string | null;
          service_date: string | null;
          status: Database["public"]["Enums"]["ticket_status"] | null;
          ticket_no: string | null;
          ticket_type: Database["public"]["Enums"]["ticket_type"] | null;
          total: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "service_tickets_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects_list";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "work_orders_list";
            referencedColumns: ["project_id"];
          },
        ];
      };
      work_orders_list: {
        Row: {
          address: string | null;
          advance_amount: number | null;
          amount_received: number | null;
          balance_due: number | null;
          client_name: string | null;
          client_phone: string | null;
          consumer_number: string | null;
          coordinator_id: string | null;
          coordinator_name: string | null;
          created_at: string | null;
          current_stage: Database["public"]["Enums"]["project_stage"] | null;
          financing_type: Database["public"]["Enums"]["financing_type"] | null;
          id: string | null;
          is_completed: boolean | null;
          kseb_section: string | null;
          last_payment_on: string | null;
          loan_bank_name: string | null;
          notes: string | null;
          order_date: string | null;
          payment_count: number | null;
          payments_total: number | null;
          plant_capacity: string | null;
          plant_capacity_kw: number | null;
          project_id: string | null;
          status: Database["public"]["Enums"]["work_order_status"] | null;
          total_cost: number | null;
          updated_at: string | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "work_orders_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      dashboard_metrics: {
        Args: Record<PropertyKey, never>;
        Returns: {
          active_projects: number;
          approved_pipeline: number;
          commissioned: number;
          commissioned_unpaid: number;
          feasibility_expiring: number;
          feasibility_extension_cost: number;
          incentive_pending: number;
          open_tickets: number;
          outstanding_amount: number;
          pending_approvals: number;
          total_work_orders: number;
        }[];
      };
      engineer_tickets: {
        Args: Record<PropertyKey, never>;
        Returns: {
          address: string;
          client_name: string;
          client_phone: string;
          consumer_number: string;
          created_at: string;
          id: string;
          kseb_section: string;
          nature_of_complaint: string;
          plant_capacity: string;
          project_id: string;
          scheduled_date: string;
          service_date: string;
          status: Database["public"]["Enums"]["ticket_status"];
          ticket_no: string;
          ticket_type: Database["public"]["Enums"]["ticket_type"];
        }[];
      };
      feasibility_periods: {
        Args: { p_as_of: string; p_started: string };
        Returns: number;
      };
      feasibility_renewal_fee: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      feasibility_validity_days: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      import_projects: {
        Args: {
          p_default_coordinator: string;
          p_rows: Json;
          p_skip_existing?: boolean;
        };
        Returns: {
          message: string;
          row_no: number;
          status: string;
          work_order_id: string;
        }[];
      };
      incentive_summary: {
        Args: { p_coordinator?: string };
        Returns: {
          paid: number;
          pending: number;
          projects: number;
          total: number;
        }[];
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_service_engineer: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_superadmin: { Args: Record<PropertyKey, never>; Returns: boolean };
      ist_today: { Args: Record<PropertyKey, never>; Returns: string };
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number };
      parse_capacity_kw: { Args: { p_label: string }; Returns: number };
      register_push_subscription: {
        Args: {
          p_auth: string;
          p_endpoint: string;
          p_p256dh: string;
          p_user_agent?: string;
        };
        Returns: string;
      };
      unregister_push_subscription: {
        Args: { p_endpoint: string };
        Returns: undefined;
      };
    };
    Enums: {
      financing_type: "self" | "loan";
      milestone_status: "pending" | "in_progress" | "completed";
      payment_method:
        | "cash"
        | "upi"
        | "bank_transfer"
        | "cheque"
        | "loan_disbursement"
        | "other";
      payment_purpose: "contract" | "kseb_fees";
      project_stage:
        | "site_feasibility_survey"
        | "kseb_portal_registration"
        | "kseb_feasibility_clearance"
        | "material_dispatch"
        | "structure_fabrication"
        | "panel_installation"
        | "wcr_submitted"
        | "kseb_inspection_meter"
        | "plant_commissioning";
      ticket_status:
        | "open"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled";
      ticket_type: "routine_6m" | "adhoc";
      user_role: "admin" | "coordinator" | "superadmin" | "service_engineer";
      work_order_status: "pending" | "approved" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      financing_type: ["self", "loan"],
      milestone_status: ["pending", "in_progress", "completed"],
      payment_method: [
        "cash",
        "upi",
        "bank_transfer",
        "cheque",
        "loan_disbursement",
        "other",
      ],
      payment_purpose: ["contract", "kseb_fees"],
      project_stage: [
        "site_feasibility_survey",
        "kseb_portal_registration",
        "kseb_feasibility_clearance",
        "material_dispatch",
        "structure_fabrication",
        "panel_installation",
        "wcr_submitted",
        "kseb_inspection_meter",
        "plant_commissioning",
      ],
      ticket_status: [
        "open",
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
      ],
      ticket_type: ["routine_6m", "adhoc"],
      user_role: ["admin", "coordinator", "superadmin", "service_engineer"],
      work_order_status: ["pending", "approved", "rejected"],
    },
  },
} as const;
