export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      project_milestones: {
        Row: {
          completed_at: string | null
          id: string
          notes: string | null
          project_id: string
          sort_order: number
          stage: Database["public"]["Enums"]["project_stage"]
          status: Database["public"]["Enums"]["milestone_status"]
        }
        Insert: {
          completed_at?: string | null
          id?: string
          notes?: string | null
          project_id: string
          sort_order: number
          stage: Database["public"]["Enums"]["project_stage"]
          status?: Database["public"]["Enums"]["milestone_status"]
        }
        Update: {
          completed_at?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          sort_order?: number
          stage?: Database["public"]["Enums"]["project_stage"]
          status?: Database["public"]["Enums"]["milestone_status"]
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          completed_at: string | null
          coordinator_id: string
          created_at: string
          current_stage: Database["public"]["Enums"]["project_stage"]
          id: string
          is_completed: boolean
          started_at: string
          updated_at: string
          work_order_id: string
        }
        Insert: {
          completed_at?: string | null
          coordinator_id: string
          created_at?: string
          current_stage?: Database["public"]["Enums"]["project_stage"]
          id?: string
          is_completed?: boolean
          started_at?: string
          updated_at?: string
          work_order_id: string
        }
        Update: {
          completed_at?: string | null
          coordinator_id?: string
          created_at?: string
          current_stage?: Database["public"]["Enums"]["project_stage"]
          id?: string
          is_completed?: boolean
          started_at?: string
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: true
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      service_tickets: {
        Row: {
          action_taken: string | null
          amc_charge: number | null
          assigned_to: string | null
          bat_bank_nos: number | null
          bat_capacity_ah: string | null
          bat_make: string | null
          bat_model: string | null
          bat_qty: number | null
          battery_voltage: string | null
          battery_water_level: string | null
          charging_current: string | null
          cost_of_spares: number | null
          created_at: string
          created_by: string | null
          defects_found: string | null
          id: string
          mppt_readings: Json | null
          nature_of_complaint: string | null
          project_id: string | null
          scheduled_date: string | null
          service_charge: number | null
          service_date: string | null
          spv_make: string | null
          spv_module_capacity: string | null
          spv_no_of_strings: number | null
          spv_string_readings: Json | null
          spv_total_nos: number | null
          spv_total_watts: number | null
          spv_voc: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          sys_capacity: string | null
          sys_loading_capacity: string | null
          sys_make: string | null
          sys_model: string | null
          sys_serial_no: string | null
          ticket_no: string | null
          ticket_type: Database["public"]["Enums"]["ticket_type"]
          total: number | null
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          amc_charge?: number | null
          assigned_to?: string | null
          bat_bank_nos?: number | null
          bat_capacity_ah?: string | null
          bat_make?: string | null
          bat_model?: string | null
          bat_qty?: number | null
          battery_voltage?: string | null
          battery_water_level?: string | null
          charging_current?: string | null
          cost_of_spares?: number | null
          created_at?: string
          created_by?: string | null
          defects_found?: string | null
          id?: string
          mppt_readings?: Json | null
          nature_of_complaint?: string | null
          project_id?: string | null
          scheduled_date?: string | null
          service_charge?: number | null
          service_date?: string | null
          spv_make?: string | null
          spv_module_capacity?: string | null
          spv_no_of_strings?: number | null
          spv_string_readings?: Json | null
          spv_total_nos?: number | null
          spv_total_watts?: number | null
          spv_voc?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          sys_capacity?: string | null
          sys_loading_capacity?: string | null
          sys_make?: string | null
          sys_model?: string | null
          sys_serial_no?: string | null
          ticket_no?: string | null
          ticket_type?: Database["public"]["Enums"]["ticket_type"]
          total?: number | null
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          amc_charge?: number | null
          assigned_to?: string | null
          bat_bank_nos?: number | null
          bat_capacity_ah?: string | null
          bat_make?: string | null
          bat_model?: string | null
          bat_qty?: number | null
          battery_voltage?: string | null
          battery_water_level?: string | null
          charging_current?: string | null
          cost_of_spares?: number | null
          created_at?: string
          created_by?: string | null
          defects_found?: string | null
          id?: string
          mppt_readings?: Json | null
          nature_of_complaint?: string | null
          project_id?: string | null
          scheduled_date?: string | null
          service_charge?: number | null
          service_date?: string | null
          spv_make?: string | null
          spv_module_capacity?: string | null
          spv_no_of_strings?: number | null
          spv_string_readings?: Json | null
          spv_total_nos?: number | null
          spv_total_watts?: number | null
          spv_voc?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          sys_capacity?: string | null
          sys_loading_capacity?: string | null
          sys_make?: string | null
          sys_model?: string | null
          sys_serial_no?: string | null
          ticket_no?: string | null
          ticket_type?: Database["public"]["Enums"]["ticket_type"]
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tickets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          address: string | null
          advance_amount: number | null
          client_name: string
          client_phone: string | null
          coordinator_id: string
          created_at: string
          id: string
          order_date: string
          plant_capacity: string
          status: Database["public"]["Enums"]["work_order_status"]
          total_cost: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          advance_amount?: number | null
          client_name: string
          client_phone?: string | null
          coordinator_id: string
          created_at?: string
          id?: string
          order_date?: string
          plant_capacity: string
          status?: Database["public"]["Enums"]["work_order_status"]
          total_cost?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          advance_amount?: number | null
          client_name?: string
          client_phone?: string | null
          coordinator_id?: string
          created_at?: string
          id?: string
          order_date?: string
          plant_capacity?: string
          status?: Database["public"]["Enums"]["work_order_status"]
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_coordinator_id_fkey"
            columns: ["coordinator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      dashboard_metrics: {
        Args: never
        Returns: {
          active_projects: number
          approved_pipeline: number
          commissioned: number
          open_tickets: number
          pending_approvals: number
          total_work_orders: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      milestone_status: "pending" | "in_progress" | "completed"
      project_stage:
        | "site_feasibility_survey"
        | "kseb_portal_registration"
        | "kseb_feasibility_clearance"
        | "material_dispatch"
        | "structure_fabrication"
        | "panel_installation"
        | "wcr_submitted"
        | "kseb_inspection_meter"
        | "plant_commissioning"
      ticket_status:
        | "open"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
      ticket_type: "routine_6m" | "adhoc"
      user_role: "admin" | "coordinator"
      work_order_status: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      milestone_status: ["pending", "in_progress", "completed"],
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
      user_role: ["admin", "coordinator"],
      work_order_status: ["pending", "approved", "rejected"],
    },
  },
} as const

