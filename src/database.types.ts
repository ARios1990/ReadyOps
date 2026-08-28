export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      agent_aliases: {
        Row: {
          agent_id: string
          alias: string
          alias_key: string | null
          created_at: string
          id: string
        }
        Insert: {
          agent_id: string
          alias: string
          alias_key?: string | null
          created_at?: string
          id?: string
        }
        Update: {
          agent_id?: string
          alias?: string
          alias_key?: string | null
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_aliases_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          access_token: string | null
          active: boolean
          email: string | null
          hourly_rate: number
          id: string
          name: string
          pay_structure: string
          payroll_lead_rate: number
          payroll_signed_contract_rate: number
          portal_slug: string | null
          team_id: string
          weekly_base: number
        }
        Insert: {
          access_token?: string | null
          active?: boolean
          email?: string | null
          hourly_rate?: number
          id?: string
          name: string
          pay_structure?: string
          payroll_lead_rate?: number
          payroll_signed_contract_rate?: number
          portal_slug?: string | null
          team_id: string
          weekly_base?: number
        }
        Update: {
          access_token?: string | null
          active?: boolean
          email?: string | null
          hourly_rate?: number
          id?: string
          name?: string
          pay_structure?: string
          payroll_lead_rate?: number
          payroll_signed_contract_rate?: number
          portal_slug?: string | null
          team_id?: string
          weekly_base?: number
        }
        Relationships: [
          {
            foreignKeyName: "agents_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_checkins: {
        Row: {
          accuracy_m: number | null
          appointment_id: string
          checked_in_at: string
          distance_m: number | null
          id: string
          latitude: number
          longitude: number
          note: string | null
          representative_id: string
          timing_status: string
          verified: boolean
        }
        Insert: {
          accuracy_m?: number | null
          appointment_id: string
          checked_in_at?: string
          distance_m?: number | null
          id?: string
          latitude: number
          longitude: number
          note?: string | null
          representative_id: string
          timing_status?: string
          verified?: boolean
        }
        Update: {
          accuracy_m?: number | null
          appointment_id?: string
          checked_in_at?: string
          distance_m?: number | null
          id?: string
          latitude?: number
          longitude?: number
          note?: string | null
          representative_id?: string
          timing_status?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "appointment_checkins_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "portal_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_checkins_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "company_representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reschedule_history: {
        Row: {
          appointment_id: string
          changed_at: string
          changed_by: string | null
          company_id: string
          id: string
          lead_id: string
          new_appointment_date: string
          new_company_id: string | null
          new_end_time: string
          new_location_id: string | null
          new_start_time: string
          old_appointment_date: string
          old_company_id: string | null
          old_end_time: string
          old_location_id: string | null
          old_start_time: string
          qc_review_id: string | null
          reason: string | null
        }
        Insert: {
          appointment_id: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          id?: string
          lead_id: string
          new_appointment_date: string
          new_company_id?: string | null
          new_end_time: string
          new_location_id?: string | null
          new_start_time: string
          old_appointment_date: string
          old_company_id?: string | null
          old_end_time: string
          old_location_id?: string | null
          old_start_time: string
          qc_review_id?: string | null
          reason?: string | null
        }
        Update: {
          appointment_id?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          id?: string
          lead_id?: string
          new_appointment_date?: string
          new_company_id?: string | null
          new_end_time?: string
          new_location_id?: string | null
          new_start_time?: string
          old_appointment_date?: string
          old_company_id?: string | null
          old_end_time?: string
          old_location_id?: string | null
          old_start_time?: string
          qc_review_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reschedule_history_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "portal_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedule_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedule_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "portal_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedule_history_new_company_id_fkey"
            columns: ["new_company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedule_history_new_location_id_fkey"
            columns: ["new_location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedule_history_old_company_id_fkey"
            columns: ["old_company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedule_history_old_location_id_fkey"
            columns: ["old_location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reschedule_history_qc_review_id_fkey"
            columns: ["qc_review_id"]
            isOneToOne: false
            referencedRelation: "qc_review_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_reservations: {
        Row: {
          agent_name: string
          appointment_date: string
          company_id: string
          converted_appointment_id: string | null
          created_at: string
          end_time: string
          expires_at: string
          id: string
          last_action: string
          location_id: string | null
          previous_appointment_date: string | null
          previous_end_time: string | null
          previous_location_id: string | null
          previous_start_time: string | null
          reservation_token: string
          session_id: string
          start_time: string
          status: string
          undo_deadline: string
          updated_at: string
        }
        Insert: {
          agent_name?: string
          appointment_date: string
          company_id: string
          converted_appointment_id?: string | null
          created_at?: string
          end_time: string
          expires_at?: string
          id?: string
          last_action?: string
          location_id?: string | null
          previous_appointment_date?: string | null
          previous_end_time?: string | null
          previous_location_id?: string | null
          previous_start_time?: string | null
          reservation_token?: string
          session_id: string
          start_time: string
          status?: string
          undo_deadline?: string
          updated_at?: string
        }
        Update: {
          agent_name?: string
          appointment_date?: string
          company_id?: string
          converted_appointment_id?: string | null
          created_at?: string
          end_time?: string
          expires_at?: string
          id?: string
          last_action?: string
          location_id?: string | null
          previous_appointment_date?: string | null
          previous_end_time?: string | null
          previous_location_id?: string | null
          previous_start_time?: string | null
          reservation_token?: string
          session_id?: string
          start_time?: string
          status?: string
          undo_deadline?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reservations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reservations_converted_appointment_id_fkey"
            columns: ["converted_appointment_id"]
            isOneToOne: false
            referencedRelation: "portal_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_reservations_previous_location_id_fkey"
            columns: ["previous_location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_label: string | null
          actor_role: string | null
          actor_user_id: string | null
          company_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          field_name: string | null
          id: string
          metadata: Json
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_role?: string | null
          actor_user_id?: string | null
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          field_name?: string | null
          id?: string
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_agent_links: {
        Row: {
          agent_id: string
          company_id: string
          id: string
        }
        Insert: {
          agent_id: string
          company_id: string
          id?: string
        }
        Update: {
          agent_id?: string
          company_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_agent_links_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_agent_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_bookings: {
        Row: {
          booked_by: string | null
          company_id: string
          created_at: string | null
          day: string
          id: string
          location_id: string | null
          time_slot: string
        }
        Insert: {
          booked_by?: string | null
          company_id: string
          created_at?: string | null
          day: string
          id?: string
          location_id?: string | null
          time_slot: string
        }
        Update: {
          booked_by?: string | null
          company_id?: string
          created_at?: string | null
          day?: string
          id?: string
          location_id?: string | null
          time_slot?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_bookings_booked_by_fkey"
            columns: ["booked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_bookings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_bookings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_location_agents: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          location_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          location_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_location_agents_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_location_agents_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_locations: {
        Row: {
          active: boolean
          address: string | null
          available_days: string[]
          city: string | null
          company_id: string
          created_at: string | null
          email: string | null
          end_time: string
          id: string
          location_label: string
          manager_name: string | null
          max_per_day: number
          max_per_hour: number
          metro_tag: string | null
          notes: string | null
          office_name: string | null
          phone: string | null
          service_cities: string[]
          service_zips: string[]
          slot_interval_minutes: number
          sort_order: number
          start_time: string
          state: string | null
          timezone: string
          updated_at: string
          zip_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          available_days?: string[]
          city?: string | null
          company_id: string
          created_at?: string | null
          email?: string | null
          end_time?: string
          id?: string
          location_label: string
          manager_name?: string | null
          max_per_day?: number
          max_per_hour?: number
          metro_tag?: string | null
          notes?: string | null
          office_name?: string | null
          phone?: string | null
          service_cities?: string[]
          service_zips?: string[]
          slot_interval_minutes?: number
          sort_order?: number
          start_time?: string
          state?: string | null
          timezone?: string
          updated_at?: string
          zip_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          available_days?: string[]
          city?: string | null
          company_id?: string
          created_at?: string | null
          email?: string | null
          end_time?: string
          id?: string
          location_label?: string
          manager_name?: string | null
          max_per_day?: number
          max_per_hour?: number
          metro_tag?: string | null
          notes?: string | null
          office_name?: string | null
          phone?: string | null
          service_cities?: string[]
          service_zips?: string[]
          slot_interval_minutes?: number
          sort_order?: number
          start_time?: string
          state?: string | null
          timezone?: string
          updated_at?: string
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_locations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_notification_batches: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          error_message: string | null
          id: string
          lead_count: number
          lead_ids: string[]
          notification_date: string
          notification_type: string
          recipient_email: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          lead_count?: number
          lead_ids?: string[]
          notification_date: string
          notification_type: string
          recipient_email?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          id?: string
          lead_count?: number
          lead_ids?: string[]
          notification_date?: string
          notification_type?: string
          recipient_email?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_notification_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_notification_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_onboarding_invites: {
        Row: {
          active: boolean
          company_id: string | null
          company_name_hint: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          invite_slug: string
          invite_token: string
          submitted_at: string | null
        }
        Insert: {
          active?: boolean
          company_id?: string | null
          company_name_hint?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          invite_slug: string
          invite_token?: string
          submitted_at?: string | null
        }
        Update: {
          active?: boolean
          company_id?: string | null
          company_name_hint?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          invite_slug?: string
          invite_token?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_onboarding_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_onboarding_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_package_locations: {
        Row: {
          created_at: string
          id: string
          location_id: string
          package_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          package_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          package_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_package_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_package_locations_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "company_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      company_packages: {
        Row: {
          agreement_data: Json
          agreement_type: string
          amount_per_lead: number
          archived_at: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          lead_target: number
          notes: string | null
          package_name: string
          package_number: number
          package_total: number
          payment_date: string | null
          payment_status: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          agreement_data?: Json
          agreement_type?: string
          amount_per_lead?: number
          archived_at?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_target: number
          notes?: string | null
          package_name?: string
          package_number: number
          package_total?: number
          payment_date?: string | null
          payment_status?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Update: {
          agreement_data?: Json
          agreement_type?: string
          amount_per_lead?: number
          archived_at?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          lead_target?: number
          notes?: string | null
          package_name?: string
          package_number?: number
          package_total?: number
          payment_date?: string | null
          payment_status?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_packages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_portal_presence: {
        Row: {
          company_id: string
          created_at: string
          current_section: string | null
          last_seen_at: string
          session_started_at: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          current_section?: string | null
          last_seen_at?: string
          session_started_at?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          current_section?: string | null
          last_seen_at?: string
          session_started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_portal_presence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_portal_settings: {
        Row: {
          allow_company_logo_update: boolean
          allow_public_booking: boolean
          check_in_after_minutes: number
          check_in_before_minutes: number
          check_in_radius_m: number
          company_access_enabled: boolean
          company_access_token: string
          company_id: string
          created_at: string
          external_form_provider: string | null
          external_form_url: string | null
          external_prefill_map: Json
          external_submission_map: Json
          external_webhook_secret: string
          form_mode: string
          form_schema: Json
          portal_enabled: boolean
          public_slug: string
          qualification_rules: Json
          requirements_detail: string
          requirements_short: string
          timezone: string
          updated_at: string
        }
        Insert: {
          allow_company_logo_update?: boolean
          allow_public_booking?: boolean
          check_in_after_minutes?: number
          check_in_before_minutes?: number
          check_in_radius_m?: number
          company_access_enabled?: boolean
          company_access_token?: string
          company_id: string
          created_at?: string
          external_form_provider?: string | null
          external_form_url?: string | null
          external_prefill_map?: Json
          external_submission_map?: Json
          external_webhook_secret?: string
          form_mode?: string
          form_schema?: Json
          portal_enabled?: boolean
          public_slug: string
          qualification_rules?: Json
          requirements_detail?: string
          requirements_short?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          allow_company_logo_update?: boolean
          allow_public_booking?: boolean
          check_in_after_minutes?: number
          check_in_before_minutes?: number
          check_in_radius_m?: number
          company_access_enabled?: boolean
          company_access_token?: string
          company_id?: string
          created_at?: string
          external_form_provider?: string | null
          external_form_url?: string | null
          external_prefill_map?: Json
          external_submission_map?: Json
          external_webhook_secret?: string
          form_mode?: string
          form_schema?: Json
          portal_enabled?: boolean
          public_slug?: string
          qualification_rules?: Json
          requirements_detail?: string
          requirements_short?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_portal_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_representatives: {
        Row: {
          access_token: string
          active: boolean
          company_id: string
          created_at: string
          email: string | null
          id: string
          location_id: string | null
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string
          active?: boolean
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          location_id?: string | null
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          active?: boolean
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          location_id?: string | null
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_representatives_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_representatives_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_schedule_exceptions: {
        Row: {
          company_id: string
          created_at: string
          end_time: string | null
          exception_date: string
          id: string
          is_closed: boolean
          location_id: string | null
          note: string | null
          start_time: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          end_time?: string | null
          exception_date: string
          id?: string
          is_closed?: boolean
          location_id?: string | null
          note?: string | null
          start_time?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          end_time?: string | null
          exception_date?: string
          id?: string
          is_closed?: boolean
          location_id?: string | null
          note?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_schedule_exceptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_schedule_exceptions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_schedule_rules: {
        Row: {
          company_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_open: boolean
          location_id: string | null
          max_per_day: number
          max_per_slot: number
          slot_minutes: number
          start_time: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          day_of_week: number
          end_time?: string
          id?: string
          is_open?: boolean
          location_id?: string | null
          max_per_day?: number
          max_per_slot?: number
          slot_minutes?: number
          start_time?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_open?: boolean
          location_id?: string | null
          max_per_day?: number
          max_per_slot?: number
          slot_minutes?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_schedule_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_schedule_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_teams: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          team_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          team_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_teams_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      company_user_access: {
        Row: {
          can_export_leads: boolean
          can_import_leads: boolean
          can_manage_logo: boolean
          can_manage_packages: boolean
          can_start_packages: boolean
          can_update_outcomes: boolean
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_export_leads?: boolean
          can_import_leads?: boolean
          can_manage_logo?: boolean
          can_manage_packages?: boolean
          can_start_packages?: boolean
          can_update_outcomes?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_export_leads?: boolean
          can_import_leads?: boolean
          can_manage_logo?: boolean
          can_manage_packages?: boolean
          can_start_packages?: boolean
          can_update_outcomes?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_user_access_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      external_form_events: {
        Row: {
          appointment_id: string | null
          company_id: string
          created_at: string
          error_message: string | null
          id: string
          lead_id: string | null
          payload: Json
          provider: string | null
          provider_submission_id: string | null
          status: string
        }
        Insert: {
          appointment_id?: string | null
          company_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json
          provider?: string | null
          provider_submission_id?: string | null
          status?: string
        }
        Update: {
          appointment_id?: string | null
          company_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json
          provider?: string | null
          provider_submission_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_form_events_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "portal_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_form_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_form_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "portal_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          lead_id: string | null
          line_total: number | null
          quantity: number
          unit_rate: number
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          invoice_id: string
          lead_id?: string | null
          line_total?: number | null
          quantity?: number
          unit_rate?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          lead_id?: string | null
          line_total?: number | null
          quantity?: number
          unit_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "portal_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          method: string | null
          notes: string | null
          payment_date: string
          reference: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          method?: string | null
          notes?: string | null
          payment_date?: string
          reference?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          method?: string | null
          notes?: string | null
          payment_date?: string
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          additional_charges: number
          amount_paid: number
          balance: number | null
          billable_leads: number
          billing_type: string
          company_id: string
          created_at: string
          created_by: string | null
          discount: number
          due_date: string | null
          id: string
          internal_notes: string | null
          invoice_number: string
          period_end: string
          period_start: string
          rate: number
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          additional_charges?: number
          amount_paid?: number
          balance?: number | null
          billable_leads?: number
          billing_type?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          internal_notes?: string | null
          invoice_number?: string
          period_end: string
          period_start: string
          rate?: number
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          additional_charges?: number
          amount_paid?: number
          balance?: number | null
          billable_leads?: number
          billing_type?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          internal_notes?: string | null
          invoice_number?: string
          period_end?: string
          period_start?: string
          rate?: number
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sync_conflicts: {
        Row: {
          company_id: string
          created_at: string
          duplicate_key: string | null
          existing_lead_id: string | null
          id: string
          incoming_data: Json
          reason: string
          row_number: number | null
          sync_run_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          duplicate_key?: string | null
          existing_lead_id?: string | null
          id?: string
          incoming_data?: Json
          reason: string
          row_number?: number | null
          sync_run_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          duplicate_key?: string | null
          existing_lead_id?: string | null
          id?: string
          incoming_data?: Json
          reason?: string
          row_number?: number | null
          sync_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_sync_conflicts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sync_conflicts_existing_lead_id_fkey"
            columns: ["existing_lead_id"]
            isOneToOne: false
            referencedRelation: "portal_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sync_conflicts_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "lead_sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sync_connections: {
        Row: {
          column_mapping: Json
          company_id: string
          created_at: string
          created_by: string | null
          display_name: string
          enabled: boolean
          id: string
          provider: string
          provider_resource_id: string | null
          sync_mode: string
          updated_at: string
          worksheet_name: string | null
        }
        Insert: {
          column_mapping?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          display_name: string
          enabled?: boolean
          id?: string
          provider: string
          provider_resource_id?: string | null
          sync_mode?: string
          updated_at?: string
          worksheet_name?: string | null
        }
        Update: {
          column_mapping?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          enabled?: boolean
          id?: string
          provider?: string
          provider_resource_id?: string | null
          sync_mode?: string
          updated_at?: string
          worksheet_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_sync_connections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sync_runs: {
        Row: {
          company_id: string
          completed_at: string | null
          connection_id: string | null
          error_summary: string | null
          failed_count: number
          filters: Json
          id: string
          imported_count: number
          provider: string
          skipped_count: number
          started_at: string
          started_by: string | null
          status: string
          updated_count: number
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          connection_id?: string | null
          error_summary?: string | null
          failed_count?: number
          filters?: Json
          id?: string
          imported_count?: number
          provider: string
          skipped_count?: number
          started_at?: string
          started_by?: string | null
          status?: string
          updated_count?: number
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          connection_id?: string | null
          error_summary?: string | null
          failed_count?: number
          filters?: Json
          id?: string
          imported_count?: number
          provider?: string
          skipped_count?: number
          started_at?: string
          started_by?: string | null
          status?: string
          updated_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "lead_sync_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sync_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "lead_sync_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_portal_links: {
        Row: {
          access_token: string
          active: boolean
          created_at: string
          id: string
          name: string
          portal_slug: string
          team_id: string
          updated_at: string
        }
        Insert: {
          access_token?: string
          active?: boolean
          created_at?: string
          id?: string
          name: string
          portal_slug: string
          team_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          portal_slug?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_portal_links_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          agent_id: string
          base_pay: number
          bonus: number
          created_at: string
          deductions: number
          hourly_rate: number
          hours: number
          id: string
          lead_rate: number
          notes: string | null
          pay_structure: string
          payroll_period_id: string
          qualified_leads: number
          signed_contract_rate: number
          signed_contracts: number
          team_id: string | null
          total_pay: number | null
          total_pay_legacy: number | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          base_pay?: number
          bonus?: number
          created_at?: string
          deductions?: number
          hourly_rate?: number
          hours?: number
          id?: string
          lead_rate?: number
          notes?: string | null
          pay_structure?: string
          payroll_period_id: string
          qualified_leads?: number
          signed_contract_rate?: number
          signed_contracts?: number
          team_id?: string | null
          total_pay?: number | null
          total_pay_legacy?: number | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          base_pay?: number
          bonus?: number
          created_at?: string
          deductions?: number
          hourly_rate?: number
          hours?: number
          id?: string
          lead_rate?: number
          notes?: string | null
          pay_structure?: string
          payroll_period_id?: string
          qualified_leads?: number
          signed_contract_rate?: number
          signed_contracts?: number
          team_id?: string | null
          total_pay?: number | null
          total_pay_legacy?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_payroll_period_id_fkey"
            columns: ["payroll_period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          id: string
          locked_at: string | null
          paid_at: string | null
          status: string
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          locked_at?: string | null
          paid_at?: string | null
          status?: string
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          locked_at?: string | null
          paid_at?: string | null
          status?: string
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      portal_appointments: {
        Row: {
          appointment_date: string
          attendance_status: string
          canonical_status: string
          canonical_status_source: string | null
          canonical_status_updated_at: string | null
          canonical_status_updated_by: string | null
          client_status: string
          company_action: string
          company_id: string
          company_visible_at: string | null
          created_at: string
          end_time: string
          external_form_status: string
          id: string
          inspection_status: string
          inspector_notes: string | null
          last_company_update_at: string | null
          lead_id: string
          location_id: string | null
          manage_token: string
          rep_status: string
          representative_id: string | null
          sales_outcome: string
          start_time: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          appointment_date: string
          attendance_status?: string
          canonical_status?: string
          canonical_status_source?: string | null
          canonical_status_updated_at?: string | null
          canonical_status_updated_by?: string | null
          client_status?: string
          company_action?: string
          company_id: string
          company_visible_at?: string | null
          created_at?: string
          end_time: string
          external_form_status?: string
          id?: string
          inspection_status?: string
          inspector_notes?: string | null
          last_company_update_at?: string | null
          lead_id: string
          location_id?: string | null
          manage_token?: string
          rep_status?: string
          representative_id?: string | null
          sales_outcome?: string
          start_time: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          appointment_date?: string
          attendance_status?: string
          canonical_status?: string
          canonical_status_source?: string | null
          canonical_status_updated_at?: string | null
          canonical_status_updated_by?: string | null
          client_status?: string
          company_action?: string
          company_id?: string
          company_visible_at?: string | null
          created_at?: string
          end_time?: string
          external_form_status?: string
          id?: string
          inspection_status?: string
          inspector_notes?: string | null
          last_company_update_at?: string | null
          lead_id?: string
          location_id?: string | null
          manage_token?: string
          rep_status?: string
          representative_id?: string | null
          sales_outcome?: string
          start_time?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_appointments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "portal_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_appointments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_appointments_representative_id_fkey"
            columns: ["representative_id"]
            isOneToOne: false
            referencedRelation: "company_representatives"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_name: string
          actor_type: string
          company_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_name?: string
          actor_type: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_name?: string
          actor_type?: string
          company_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_leads: {
        Row: {
          address: string
          agent_id: string | null
          agent_name: string
          agent_profile_id: string | null
          city: string | null
          company_id: string
          created_at: string
          email: string | null
          external_form_status: string
          external_submission_id: string | null
          form_data: Json
          full_name: string
          home_value: number | null
          id: string
          import_dedupe_key: string | null
          language: string | null
          lead_code: string
          location_id: string | null
          notes: string | null
          original_company_id: string | null
          package_id: string | null
          phone_number: string
          property_latitude: number | null
          property_longitude: number | null
          qc_notes: string | null
          qc_reason: string | null
          qc_required: boolean
          qc_reviewed_at: string | null
          qc_reviewed_by: string | null
          qc_status: string
          qualification_reasons: Json
          qualification_status: string
          recording_url: string | null
          service_needed: string | null
          session_id: string | null
          share_recording_with_company: boolean
          source: string
          source_disposition: string | null
          source_lead_id: string | null
          sq_ft: number | null
          state: string | null
          updated_at: string
          web_url: string | null
          zip_code: string | null
        }
        Insert: {
          address: string
          agent_id?: string | null
          agent_name?: string
          agent_profile_id?: string | null
          city?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          external_form_status?: string
          external_submission_id?: string | null
          form_data?: Json
          full_name: string
          home_value?: number | null
          id?: string
          import_dedupe_key?: string | null
          language?: string | null
          lead_code?: string
          location_id?: string | null
          notes?: string | null
          original_company_id?: string | null
          package_id?: string | null
          phone_number: string
          property_latitude?: number | null
          property_longitude?: number | null
          qc_notes?: string | null
          qc_reason?: string | null
          qc_required?: boolean
          qc_reviewed_at?: string | null
          qc_reviewed_by?: string | null
          qc_status?: string
          qualification_reasons?: Json
          qualification_status?: string
          recording_url?: string | null
          service_needed?: string | null
          session_id?: string | null
          share_recording_with_company?: boolean
          source?: string
          source_disposition?: string | null
          source_lead_id?: string | null
          sq_ft?: number | null
          state?: string | null
          updated_at?: string
          web_url?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string
          agent_id?: string | null
          agent_name?: string
          agent_profile_id?: string | null
          city?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          external_form_status?: string
          external_submission_id?: string | null
          form_data?: Json
          full_name?: string
          home_value?: number | null
          id?: string
          import_dedupe_key?: string | null
          language?: string | null
          lead_code?: string
          location_id?: string | null
          notes?: string | null
          original_company_id?: string | null
          package_id?: string | null
          phone_number?: string
          property_latitude?: number | null
          property_longitude?: number | null
          qc_notes?: string | null
          qc_reason?: string | null
          qc_required?: boolean
          qc_reviewed_at?: string | null
          qc_reviewed_by?: string | null
          qc_status?: string
          qualification_reasons?: Json
          qualification_status?: string
          recording_url?: string | null
          service_needed?: string | null
          session_id?: string | null
          share_recording_with_company?: boolean
          source?: string
          source_disposition?: string | null
          source_lead_id?: string | null
          sq_ft?: number | null
          state?: string | null
          updated_at?: string
          web_url?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_leads_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_leads_agent_profile_id_fkey"
            columns: ["agent_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_leads_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_leads_original_company_id_fkey"
            columns: ["original_company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_leads_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "company_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_leads_qc_reviewed_by_fkey"
            columns: ["qc_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agent_id: string | null
          created_at: string | null
          display_name: string
          email: string | null
          id: string
          role: string
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          display_name?: string
          email?: string | null
          id: string
          role?: string
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          display_name?: string
          email?: string | null
          id?: string
          role?: string
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_lead_transcripts: {
        Row: {
          language: string | null
          lead_id: string
          method: string
          summary: string
          transcript: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          language?: string | null
          lead_id: string
          method?: string
          summary?: string
          transcript?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          language?: string | null
          lead_id?: string
          method?: string
          summary?: string
          transcript?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qc_lead_transcripts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "portal_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_review_cycles: {
        Row: {
          appointment_id: string
          assigned_to: string | null
          company_id: string
          completed_at: string | null
          correction_assignee_id: string | null
          correction_attempt: number
          created_at: string
          cycle_number: number
          id: string
          is_current: boolean
          lead_id: string
          location_id: string | null
          notes: string | null
          reason: string | null
          reviewer_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          assigned_to?: string | null
          company_id: string
          completed_at?: string | null
          correction_assignee_id?: string | null
          correction_attempt?: number
          created_at?: string
          cycle_number: number
          id?: string
          is_current?: boolean
          lead_id: string
          location_id?: string | null
          notes?: string | null
          reason?: string | null
          reviewer_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          assigned_to?: string | null
          company_id?: string
          completed_at?: string | null
          correction_assignee_id?: string | null
          correction_attempt?: number
          created_at?: string
          cycle_number?: number
          id?: string
          is_current?: boolean
          lead_id?: string
          location_id?: string | null
          notes?: string | null
          reason?: string | null
          reviewer_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_review_cycles_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "portal_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_review_cycles_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_review_cycles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "roster_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_review_cycles_correction_assignee_id_fkey"
            columns: ["correction_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_review_cycles_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "portal_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_review_cycles_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "company_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_review_cycles_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      readymode_integration_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: boolean
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: boolean
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: boolean
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      roster_companies: {
        Row: {
          account_status: string
          billing_address: string | null
          billing_email: string | null
          client_id: string | null
          contact_name: string | null
          email: string | null
          id: string
          logo_path: string | null
          metro_tag: string | null
          name: string
          notes: string | null
          owner_email: string | null
          phone: string | null
          requirements_note: string | null
          secondary_emails: string[]
          state: string | null
          team_id: string | null
          website: string | null
        }
        Insert: {
          account_status?: string
          billing_address?: string | null
          billing_email?: string | null
          client_id?: string | null
          contact_name?: string | null
          email?: string | null
          id?: string
          logo_path?: string | null
          metro_tag?: string | null
          name: string
          notes?: string | null
          owner_email?: string | null
          phone?: string | null
          requirements_note?: string | null
          secondary_emails?: string[]
          state?: string | null
          team_id?: string | null
          website?: string | null
        }
        Update: {
          account_status?: string
          billing_address?: string | null
          billing_email?: string | null
          client_id?: string | null
          contact_name?: string | null
          email?: string | null
          id?: string
          logo_path?: string | null
          metro_tag?: string | null
          name?: string
          notes?: string | null
          owner_email?: string | null
          phone?: string | null
          requirements_note?: string | null
          secondary_emails?: string[]
          state?: string | null
          team_id?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roster_companies_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_bookings: {
        Row: {
          agent_id: string
          created_at: string | null
          day: string
          id: string
          time_slot: string
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          day: string
          id?: string
          time_slot: string
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          day?: string
          id?: string
          time_slot?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_bookings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          abbreviation: string
          id: string
          name: string
        }
        Insert: {
          abbreviation: string
          id?: string
          name: string
        }
        Update: {
          abbreviation?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          created_at: string
          current_path: string | null
          last_seen_at: string
          session_started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_path?: string | null
          last_seen_at?: string
          session_started_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_path?: string | null
          last_seen_at?: string
          session_started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_clear_manual_slot_blocks: { Args: never; Returns: number }
      admin_update_lead_crm: {
        Args: {
          p_appointment_patch?: Json
          p_lead_id: string
          p_lead_patch?: Json
        }
        Returns: Json
      }
      agent_resubmit_correction: {
        Args: { p_access_token: string; p_form_data: Json; p_lead_id: string }
        Returns: Json
      }
      assign_appointment_representative: {
        Args: {
          p_access_token: string
          p_appointment_id: string
          p_company_id: string
          p_representative_id: string
        }
        Returns: Json
      }
      company_create_package_v2: {
        Args: { p_company_id: string; p_force_close?: boolean; p_package: Json }
        Returns: Json
      }
      company_import_leads: {
        Args: {
          p_company_id: string
          p_mode?: string
          p_provider: string
          p_rows: Json
        }
        Returns: Json
      }
      company_record_export: {
        Args: {
          p_company_id: string
          p_filters: Json
          p_format: string
          p_row_count: number
        }
        Returns: string
      }
      company_set_logo_path: {
        Args: { p_company_id: string; p_path: string }
        Returns: Json
      }
      company_update_appointment_status: {
        Args: {
          p_access_token: string
          p_appointment_id: string
          p_company_id: string
          p_status: string
        }
        Returns: Json
      }
      company_update_canonical_status: {
        Args: {
          p_appointment_id: string
          p_company_id: string
          p_new_date?: string
          p_new_start_time?: string
          p_reason?: string
          p_status: string
        }
        Returns: Json
      }
      company_update_lead_outcome: {
        Args: {
          p_access_token: string
          p_appointment_id: string
          p_client_status: string
          p_company_id: string
          p_notes?: string
        }
        Returns: Json
      }
      company_update_package_v2: {
        Args: { p_company_id: string; p_package_id: string; p_patch: Json }
        Returns: Json
      }
      create_company_onboarding_invite: {
        Args: { p_company_name_hint?: string; p_expires_days?: number }
        Returns: Json
      }
      create_company_package: {
        Args: {
          p_amount_per_lead: number
          p_company_id: string
          p_lead_target: number
          p_package_name?: string
          p_package_total: number
          p_payment_date?: string
          p_payment_status?: string
        }
        Returns: Json
      }
      create_company_portal_location: {
        Args: { p_access_token: string; p_company_id: string; p_location: Json }
        Returns: Json
      }
      create_company_representative: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_representative: Json
        }
        Returns: Json
      }
      create_company_schedule_exception: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_exception: Json
        }
        Returns: Json
      }
      create_location_scoped_company_package: {
        Args: {
          p_amount_per_lead: number
          p_company_id: string
          p_lead_target: number
          p_location_ids: string[]
          p_package_name: string
          p_package_total: number
          p_payment_date: string
          p_payment_status: string
        }
        Returns: Json
      }
      create_readyops_invoice: {
        Args: {
          p_additional_charges?: number
          p_billing_type?: string
          p_company_id: string
          p_discount?: number
          p_due_date?: string
          p_period_end: string
          p_period_start: string
          p_rate?: number
        }
        Returns: string
      }
      current_agent_id: { Args: never; Returns: string }
      current_profile_role: { Args: never; Returns: string }
      current_team_id: { Args: never; Returns: string }
      delete_company_schedule_exception: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_exception_id: string
        }
        Returns: boolean
      }
      generate_readyops_payroll_week: {
        Args: { p_date?: string }
        Returns: string
      }
      get_admin_lead_crm: {
        Args: {
          p_client_status?: string
          p_company_id?: string
          p_date_basis?: string
          p_end_date?: string
          p_limit?: number
          p_offset?: number
          p_qc_status?: string
          p_search?: string
          p_source?: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_admin_lead_crm_detail: { Args: { p_lead_id: string }; Returns: Json }
      get_agent_correction: {
        Args: { p_access_token: string; p_lead_id: string }
        Returns: Json
      }
      get_agent_portal: {
        Args: {
          p_access_token: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_company_lead_spreadsheet: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_filter?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      get_company_location_lead_spreadsheet: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_end_date?: string
          p_filter?: string
          p_limit?: number
          p_location_id?: string
          p_offset?: number
          p_representative_id?: string
          p_search?: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_company_management_dashboard_summary: {
        Args: { p_access_token: string; p_company_id: string }
        Returns: Json
      }
      get_company_management_portal: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_end_date: string
          p_start_date: string
        }
        Returns: Json
      }
      get_company_management_portal_by_slug: {
        Args: {
          p_access_token: string
          p_end_date: string
          p_slug: string
          p_start_date: string
        }
        Returns: Json
      }
      get_company_management_v2: {
        Args: { p_company_id: string; p_end_date: string; p_start_date: string }
        Returns: Json
      }
      get_company_management_v2_by_slug: {
        Args: { p_end_date: string; p_slug: string; p_start_date: string }
        Returns: Json
      }
      get_company_onboarding_invite: {
        Args: { p_invite_slug: string; p_invite_token: string }
        Returns: Json
      }
      get_company_operations_overview: { Args: never; Returns: Json }
      get_manager_link_overview: {
        Args: {
          p_access_token: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_manager_team_overview: {
        Args: { p_end_date?: string; p_start_date?: string; p_team_id?: string }
        Returns: Json
      }
      get_public_booking_portal: {
        Args: {
          p_end_date: string
          p_location_id: string
          p_slug: string
          p_start_date: string
        }
        Returns: Json
      }
      get_public_booking_portal_active_locations: {
        Args: {
          p_end_date: string
          p_location_id: string
          p_slug: string
          p_start_date: string
        }
        Returns: Json
      }
      get_public_location_timezone: {
        Args: { p_location_id: string; p_slug: string }
        Returns: string
      }
      get_qc_calendar_queue: {
        Args: {
          p_agent_id?: string
          p_appointment_status?: string
          p_company_id?: string
          p_date_basis?: string
          p_end_date: string
          p_location_id?: string
          p_qc_status?: string
          p_search?: string
          p_service_area?: string
          p_start_date: string
          p_state?: string
        }
        Returns: Json
      }
      get_qc_needs_review_focus: { Args: never; Returns: Json }
      get_qc_queue: {
        Args: {
          p_company_id?: string
          p_end_date?: string
          p_qc_status?: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_qc_reference_data: { Args: never; Returns: Json }
      get_representative_portal: {
        Args: {
          p_access_token: string
          p_end_date: string
          p_start_date: string
        }
        Returns: Json
      }
      get_user_agent_id: { Args: never; Returns: string }
      get_user_role: { Args: never; Returns: string }
      get_user_team_id: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      mark_external_form_opened: {
        Args: { p_manage_token: string }
        Returns: boolean
      }
      move_public_reservation_slot: {
        Args: {
          p_date: string
          p_location_id: string
          p_reservation_token: string
          p_session_id: string
          p_start_time: string
        }
        Returns: Json
      }
      portal_active_package: { Args: { p_company_id: string }; Returns: string }
      portal_active_package_for_location: {
        Args: { p_company_id: string; p_location_id: string }
        Returns: string
      }
      portal_actor_name_for_management: { Args: never; Returns: string }
      portal_actor_type_for_management: {
        Args: { p_access_token: string }
        Returns: string
      }
      portal_add_representative: {
        Args: {
          p_access_token: string
          p_email?: string
          p_location_id?: string
          p_name: string
          p_phone?: string
        }
        Returns: Json
      }
      portal_assert_slot_capacity: {
        Args: {
          p_allow_past?: boolean
          p_company_id: string
          p_date: string
          p_exclude_appointment_id?: string
          p_exclude_reservation_id?: string
          p_location_id: string
          p_start: string
        }
        Returns: {
          company_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_open: boolean
          location_id: string | null
          max_per_day: number
          max_per_slot: number
          slot_minutes: number
          start_time: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "company_schedule_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      portal_assign_representative: {
        Args: {
          p_access_token: string
          p_appointment_id: string
          p_representative_id: string
        }
        Returns: boolean
      }
      portal_calculate_qualification: {
        Args: { p_fields: Json; p_rules: Json }
        Returns: Json
      }
      portal_change_reservation: {
        Args: {
          p_new_date: string
          p_new_start_time: string
          p_reservation_id: string
          p_session_token: string
        }
        Returns: Json
      }
      portal_complete_package_if_filled: {
        Args: { p_package_id: string }
        Returns: undefined
      }
      portal_default_form_schema: { Args: never; Returns: Json }
      portal_default_form_schema_legacy: { Args: never; Returns: Json }
      portal_default_qualification_rules: { Args: never; Returns: Json }
      portal_evaluate_qualification: {
        Args: { p_form_data: Json; p_rules: Json }
        Returns: Json
      }
      portal_expire_reservations: { Args: never; Returns: number }
      portal_find_rule: {
        Args: {
          p_company_id: string
          p_day_of_week: number
          p_location_id: string
        }
        Returns: {
          company_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_open: boolean
          location_id: string | null
          max_per_day: number
          max_per_slot: number
          slot_minutes: number
          start_time: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "company_schedule_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      portal_get_appointment: {
        Args: { p_manage_token: string }
        Returns: Json
      }
      portal_get_company_admin: {
        Args: { p_access_token: string }
        Returns: Json
      }
      portal_get_public_company: { Args: { p_slug: string }; Returns: Json }
      portal_get_public_week: {
        Args: { p_location_id?: string; p_slug: string; p_week_start?: string }
        Returns: Json
      }
      portal_get_rep_portal: { Args: { p_access_token: string }; Returns: Json }
      portal_haversine_meters: {
        Args: { lat1: number; lat2: number; lon1: number; lon2: number }
        Returns: number
      }
      portal_is_admin: { Args: never; Returns: boolean }
      portal_is_qc_or_admin: { Args: never; Returns: boolean }
      portal_next_lead_code: { Args: never; Returns: string }
      portal_normalize_form_schema: { Args: { p_schema: Json }; Returns: Json }
      portal_normalize_match_text: {
        Args: { p_value: string }
        Returns: string
      }
      portal_rep_check_in: {
        Args: {
          p_access_token: string
          p_accuracy_m?: number
          p_appointment_id: string
          p_explanation?: string
          p_latitude: number
          p_longitude: number
        }
        Returns: Json
      }
      portal_rep_update_status: {
        Args: {
          p_access_token: string
          p_action: string
          p_appointment_id: string
          p_notes?: string
        }
        Returns: boolean
      }
      portal_reschedule_appointment: {
        Args: {
          p_manage_token: string
          p_new_date: string
          p_new_start_time: string
        }
        Returns: Json
      }
      portal_reserve_slot: {
        Args: {
          p_created_by_name?: string
          p_date: string
          p_location_id: string
          p_session_token: string
          p_slug: string
          p_start_time: string
        }
        Returns: Json
      }
      portal_resolve_agent_id: {
        Args: { p_agent_name: string; p_form_data: Json }
        Returns: string
      }
      portal_resolve_company_access: {
        Args: { p_access_token: string; p_company_id: string }
        Returns: string
      }
      portal_slot_is_blocked: {
        Args: {
          p_company_id: string
          p_date: string
          p_end: string
          p_location_id: string
          p_start: string
        }
        Returns: boolean
      }
      portal_slot_statuses: {
        Args: { p_company_id: string; p_date: string; p_location_id: string }
        Returns: {
          booked_count: number
          capacity: number
          slot_end: string
          slot_start: string
          status: string
        }[]
      }
      portal_slugify: { Args: { value: string }; Returns: string }
      portal_submit_lead: {
        Args: {
          p_agent_name?: string
          p_fields: Json
          p_reservation_id: string
          p_session_token: string
        }
        Returns: Json
      }
      portal_undo_reservation: {
        Args: { p_reservation_id: string; p_session_token: string }
        Returns: boolean
      }
      portal_update_company_settings: {
        Args: { p_access_token: string; p_updates: Json }
        Returns: Json
      }
      portal_upsert_schedule_rule: {
        Args: {
          p_access_token: string
          p_day_of_week: number
          p_end_time: string
          p_is_open: boolean
          p_location_id: string
          p_max_per_day: number
          p_max_per_slot: number
          p_slot_minutes: number
          p_start_time: string
        }
        Returns: Json
      }
      portal_validate_slot: {
        Args: {
          p_allow_past?: boolean
          p_company_id: string
          p_date: string
          p_location_id: string
          p_start: string
        }
        Returns: {
          company_id: string
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_open: boolean
          location_id: string | null
          max_per_day: number
          max_per_slot: number
          slot_minutes: number
          start_time: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "company_schedule_rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      portal_write_audit: {
        Args: {
          p_action: string
          p_actor_id: string
          p_actor_name: string
          p_actor_type: string
          p_company_id: string
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_new_value?: Json
          p_old_value?: Json
        }
        Returns: undefined
      }
      prepare_company_end_of_day_notification: {
        Args: { p_company_id: string; p_notification_date?: string }
        Returns: Json
      }
      qc_admin_override_schedule: {
        Args: {
          p_date: string
          p_lead_id: string
          p_reason: string
          p_start_time: string
        }
        Returns: Json
      }
      qc_delete_lead: {
        Args: { p_lead_id: string; p_reason?: string }
        Returns: Json
      }
      qc_log_export: {
        Args: { p_filters: Json; p_row_count: number }
        Returns: string
      }
      qc_move_lead: {
        Args: {
          p_company_id: string
          p_date: string
          p_lead_id: string
          p_location_id: string
          p_reason?: string
          p_start_time: string
        }
        Returns: Json
      }
      qc_reassign_lead_agent: {
        Args: { p_agent_id: string; p_lead_id: string }
        Returns: Json
      }
      qc_reopen_review: {
        Args: { p_lead_id: string; p_reason: string }
        Returns: Json
      }
      qc_resubmit_correction: {
        Args: { p_lead_id: string; p_notes?: string }
        Returns: Json
      }
      qc_review_lead: {
        Args: {
          p_decision: string
          p_lead_id: string
          p_notes?: string
          p_reason?: string
        }
        Returns: Json
      }
      qc_send_lead_to_client: { Args: { p_lead_id: string }; Returns: Json }
      qc_start_review: { Args: { p_lead_id: string }; Returns: Json }
      qc_update_lead: {
        Args: { p_lead_id: string; p_patch: Json }
        Returns: Json
      }
      ready_mode_prefill_query: { Args: never; Returns: string }
      readyops_company_management_role: {
        Args: { p_company_id: string }
        Returns: string
      }
      readyops_delivered_lead_count: {
        Args: { p_package_id: string }
        Returns: number
      }
      record_company_portal_presence: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_current_section?: string
          p_session_started_at: string
        }
        Returns: boolean
      }
      refresh_public_reservation: {
        Args: { p_reservation_token: string; p_session_id: string }
        Returns: Json
      }
      regenerate_agent_portal_link: {
        Args: { p_agent_id: string }
        Returns: Json
      }
      regenerate_company_access_token: {
        Args: { p_access_token: string; p_company_id: string }
        Returns: string
      }
      regenerate_external_webhook_secret: {
        Args: { p_access_token: string; p_company_id: string }
        Returns: string
      }
      representative_check_in: {
        Args: {
          p_access_token: string
          p_accuracy_m: number
          p_appointment_id: string
          p_latitude: number
          p_longitude: number
          p_note?: string
        }
        Returns: Json
      }
      representative_update_appointment: {
        Args: {
          p_access_token: string
          p_action: string
          p_appointment_id: string
          p_note?: string
        }
        Returns: Json
      }
      reschedule_public_appointment: {
        Args: {
          p_actor_name: string
          p_date: string
          p_location_id: string
          p_manage_token: string
          p_start_time: string
        }
        Returns: Json
      }
      reserve_public_appointment_slot: {
        Args: {
          p_agent_name: string
          p_date: string
          p_location_id: string
          p_session_id: string
          p_slug: string
          p_start_time: string
        }
        Returns: Json
      }
      resolve_readymode_campaign: {
        Args: { p_campaign_name: string }
        Returns: Json
      }
      save_readyops_payroll_entry: {
        Args: {
          p_base_pay: number
          p_bonus: number
          p_deductions: number
          p_entry_id: string
          p_hourly_rate: number
          p_hours: number
          p_lead_rate: number
          p_notes?: string
          p_pay_structure: string
          p_signed_contract_rate: number
        }
        Returns: undefined
      }
      search_qc_leads_global: {
        Args: {
          p_agent_id?: string
          p_appointment_status?: string
          p_company_id?: string
          p_limit?: number
          p_location_id?: string
          p_qc_status?: string
          p_search: string
          p_service_area?: string
          p_state?: string
          p_team_id?: string
        }
        Returns: Json
      }
      submit_company_onboarding: {
        Args: { p_invite_slug: string; p_invite_token: string; p_payload: Json }
        Returns: Json
      }
      submit_public_appointment: {
        Args: {
          p_agent_name: string
          p_form_data: Json
          p_reservation_token: string
          p_session_id: string
        }
        Returns: Json
      }
      sync_external_form_submission: {
        Args: {
          p_company_id: string
          p_lead_code: string
          p_payload: Json
          p_provider_submission_id: string
          p_secret: string
        }
        Returns: Json
      }
      sync_readymode_lead: {
        Args: {
          p_disposition: string
          p_payload: Json
          p_secret: string
          p_source_lead_id: string
        }
        Returns: Json
      }
      undo_public_reservation_action: {
        Args: { p_reservation_token: string; p_session_id: string }
        Returns: Json
      }
      update_company_package: {
        Args: { p_package_id: string; p_patch: Json }
        Returns: Json
      }
      update_company_portal_location: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_location_id: string
          p_patch: Json
        }
        Returns: Json
      }
      update_company_portal_name: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_company_name: string
        }
        Returns: Json
      }
      update_company_portal_settings: {
        Args: { p_access_token: string; p_company_id: string; p_patch: Json }
        Returns: Json
      }
      update_company_representative: {
        Args: {
          p_access_token: string
          p_company_id: string
          p_patch: Json
          p_representative_id: string
        }
        Returns: Json
      }
      upsert_company_schedule_rule: {
        Args: { p_access_token: string; p_company_id: string; p_rule: Json }
        Returns: Json
      }
      user_can_access_company: {
        Args: { company_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const

