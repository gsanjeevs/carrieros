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
      carrier_details: {
        Row: {
          billing_status: string
          card_brand: string | null
          card_last4: string | null
          default_language: string
          default_payment_method: string
          dot_number: string | null
          factoring_company: string | null
          load_email: string | null
          mc_number: string | null
          org_id: number
          stripe_customer_id: string | null
          tier: string | null
          timezone: string | null
          trial_ends_at: string | null
          uom_system: string | null
        }
        Insert: {
          billing_status?: string
          card_brand?: string | null
          card_last4?: string | null
          default_language?: string
          default_payment_method?: string
          dot_number?: string | null
          factoring_company?: string | null
          load_email?: string | null
          mc_number?: string | null
          org_id: number
          stripe_customer_id?: string | null
          tier?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          uom_system?: string | null
        }
        Update: {
          billing_status?: string
          card_brand?: string | null
          card_last4?: string | null
          default_language?: string
          default_payment_method?: string
          dot_number?: string | null
          factoring_company?: string | null
          load_email?: string | null
          mc_number?: string | null
          org_id?: number
          stripe_customer_id?: string | null
          tier?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          uom_system?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_details: {
        Row: {
          carrier_org_id: number
          contact_name: string | null
          customer_number: string | null
          notes: string | null
          org_id: number
          tags: string[] | null
        }
        Insert: {
          carrier_org_id: number
          contact_name?: string | null
          customer_number?: string | null
          notes?: string | null
          org_id: number
          tags?: string[] | null
        }
        Update: {
          carrier_org_id?: number
          contact_name?: string | null
          customer_number?: string | null
          notes?: string | null
          org_id?: number
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_details_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          carrier_org_id: number | null
          created_at: string | null
          id: number
          load_id: number | null
          storage_path: string
          type: string | null
          uploaded_by: string | null
        }
        Insert: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          load_id?: number | null
          storage_path: string
          type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          load_id?: number | null
          storage_path?: string
          type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_documents: {
        Row: {
          carrier_org_id: number | null
          created_at: string | null
          doc_type: string
          driver_id: number | null
          expiry_date: string | null
          id: number
          label: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          carrier_org_id?: number | null
          created_at?: string | null
          doc_type: string
          driver_id?: number | null
          expiry_date?: string | null
          id?: number
          label?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          carrier_org_id?: number | null
          created_at?: string | null
          doc_type?: string
          driver_id?: number | null
          expiry_date?: string | null
          id?: number
          label?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_documents_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_documents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          carrier_org_id: number
          cdl_class: string | null
          cdl_expiry: string | null
          cdl_number: string | null
          cdl_state: string | null
          created_at: string | null
          default_vehicle_id: number | null
          driver_number: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relation: string | null
          endorsements: string[] | null
          id: number
          invite_status: string | null
          is_active: boolean | null
          med_cert_expiry: string | null
          profile_id: string
        }
        Insert: {
          carrier_org_id: number
          cdl_class?: string | null
          cdl_expiry?: string | null
          cdl_number?: string | null
          cdl_state?: string | null
          created_at?: string | null
          default_vehicle_id?: number | null
          driver_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          endorsements?: string[] | null
          id?: number
          invite_status?: string | null
          is_active?: boolean | null
          med_cert_expiry?: string | null
          profile_id: string
        }
        Update: {
          carrier_org_id?: number
          cdl_class?: string | null
          cdl_expiry?: string | null
          cdl_number?: string | null
          cdl_state?: string | null
          created_at?: string | null
          default_vehicle_id?: number | null
          driver_number?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relation?: string | null
          endorsements?: string[] | null
          id?: number
          invite_status?: string | null
          is_active?: boolean | null
          med_cert_expiry?: string | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_default_truck_id_fkey"
            columns: ["default_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dvir_defects: {
        Row: {
          area: string
          created_at: string | null
          description: string | null
          id: number
          inspection_id: number | null
          photo_path: string | null
          severity: string | null
        }
        Insert: {
          area: string
          created_at?: string | null
          description?: string | null
          id?: number
          inspection_id?: number | null
          photo_path?: string | null
          severity?: string | null
        }
        Update: {
          area?: string
          created_at?: string | null
          description?: string | null
          id?: number
          inspection_id?: number | null
          photo_path?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dvir_defects_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "dvir_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      dvir_inspections: {
        Row: {
          carrier_org_id: number | null
          condition: string
          created_at: string | null
          driver_id: number | null
          id: number
          load_id: number | null
          odometer: number | null
          signature_url: string | null
          submitted_at: string | null
          type: string
          vehicle_id: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          condition: string
          created_at?: string | null
          driver_id?: number | null
          id?: number
          load_id?: number | null
          odometer?: number | null
          signature_url?: string | null
          submitted_at?: string | null
          type: string
          vehicle_id?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          condition?: string
          created_at?: string | null
          driver_id?: number | null
          id?: number
          load_id?: number | null
          odometer?: number | null
          signature_url?: string | null
          submitted_at?: string | null
          type?: string
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dvir_inspections_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dvir_inspections_truck_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      features: {
        Row: {
          display_order: number
          key: string
          label: string
          min_tier: string
        }
        Insert: {
          display_order: number
          key: string
          label: string
          min_tier: string
        }
        Update: {
          display_order?: number
          key?: string
          label?: string
          min_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "features_min_tier_fkey"
            columns: ["min_tier"]
            isOneToOne: false
            referencedRelation: "tiers"
            referencedColumns: ["code"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          carrier_org_id: number
          created_at: string | null
          customer_org_id: number | null
          due_date: string | null
          factored_at: string | null
          factoring_company: string | null
          factoring_reference: string | null
          id: number
          invoice_number: string
          load_id: number | null
          notes: string | null
          paid_at: string | null
          payment_method: string
          sent_at: string | null
          status: string | null
        }
        Insert: {
          amount: number
          carrier_org_id: number
          created_at?: string | null
          customer_org_id?: number | null
          due_date?: string | null
          factored_at?: string | null
          factoring_company?: string | null
          factoring_reference?: string | null
          id?: number
          invoice_number: string
          load_id?: number | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          amount?: number
          carrier_org_id?: number
          created_at?: string | null
          customer_org_id?: number | null
          due_date?: string | null
          factored_at?: string | null
          factoring_company?: string | null
          factoring_reference?: string | null
          id?: number
          invoice_number?: string
          load_id?: number | null
          notes?: string | null
          paid_at?: string | null
          payment_method?: string
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_org_id_fkey"
            columns: ["customer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
        ]
      }
      languages: {
        Row: {
          code: string
          display_order: number
          flag_emoji: string
          label: string
          native_name: string
        }
        Insert: {
          code: string
          display_order: number
          flag_emoji: string
          label: string
          native_name: string
        }
        Update: {
          code?: string
          display_order?: number
          flag_emoji?: string
          label?: string
          native_name?: string
        }
        Relationships: []
      }
      load_events: {
        Row: {
          created_at: string | null
          created_by: string | null
          event_type: string
          id: number
          load_id: number
          location_lat: number | null
          location_lng: number | null
          note: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          event_type: string
          id?: number
          load_id: number
          location_lat?: number | null
          location_lng?: number | null
          note?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          event_type?: string
          id?: number
          load_id?: number
          location_lat?: number | null
          location_lng?: number | null
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "load_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_events_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_events_load_id_fkey"
            columns: ["load_id"]
            isOneToOne: false
            referencedRelation: "loads_driver_view"
            referencedColumns: ["id"]
          },
        ]
      }
      loads: {
        Row: {
          carrier_org_id: number
          commodity: string | null
          created_at: string | null
          customer_name_raw: string | null
          customer_org_id: number | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_date: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_state: string | null
          delivery_time: string | null
          delivery_zip: string | null
          driver_id: number | null
          extraction_data: Json | null
          id: number
          intake_method: string | null
          last_location_at: string | null
          last_location_lat: number | null
          last_location_lng: number | null
          load_number: string
          pickup_address: string | null
          pickup_city: string | null
          pickup_date: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_state: string | null
          pickup_time: string | null
          pickup_zip: string | null
          rate: number | null
          raw_intake_text: string | null
          status: string | null
          total_miles: number | null
          tracking_token: string | null
          updated_at: string | null
          vehicle_id: number | null
          weight_lbs: number | null
        }
        Insert: {
          carrier_org_id: number
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          extraction_data?: Json | null
          id?: number
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number: string
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          rate?: number | null
          raw_intake_text?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          updated_at?: string | null
          vehicle_id?: number | null
          weight_lbs?: number | null
        }
        Update: {
          carrier_org_id?: number
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          extraction_data?: Json | null
          id?: number
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number?: string
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          rate?: number | null
          raw_intake_text?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          updated_at?: string | null
          vehicle_id?: number | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loads_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_customer_org_id_fkey"
            columns: ["customer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_truck_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_reminders: {
        Row: {
          carrier_org_id: number | null
          created_at: string | null
          id: number
          is_active: boolean | null
          last_odometer: number | null
          last_service_date: string | null
          next_due_date: string | null
          next_due_miles: number | null
          reminder_type: string
          trigger_miles: number | null
          trigger_months: number | null
          vehicle_id: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          last_odometer?: number | null
          last_service_date?: string | null
          next_due_date?: string | null
          next_due_miles?: number | null
          reminder_type: string
          trigger_miles?: number | null
          trigger_months?: number | null
          vehicle_id?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          last_odometer?: number | null
          last_service_date?: string | null
          next_due_date?: string | null
          next_due_miles?: number | null
          reminder_type?: string
          trigger_miles?: number | null
          trigger_months?: number | null
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_reminders_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_reminders_truck_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_documents: {
        Row: {
          created_at: string | null
          doc_type: string
          expiry_date: string | null
          id: number
          label: string | null
          org_id: number | null
          storage_path: string
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          doc_type: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          org_id?: number | null
          storage_path: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          doc_type?: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          org_id?: number | null
          storage_path?: string
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_sequences: {
        Row: {
          entity: string
          last_val: number | null
          org_id: number
        }
        Insert: {
          entity: string
          last_val?: number | null
          org_id: number
        }
        Update: {
          entity?: string
          last_val?: number | null
          org_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string | null
          currency: string | null
          email: string | null
          id: number
          logo_path: string | null
          name: string
          phone: string | null
          state: string | null
          type: string
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: number
          logo_path?: string | null
          name: string
          phone?: string | null
          state?: string | null
          type: string
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: number
          logo_path?: string | null
          name?: string
          phone?: string | null
          state?: string | null
          type?: string
          zip?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string | null
          date_format: string | null
          first_name: string | null
          id: string
          last_name: string | null
          org_id: number
          phone: string | null
          preferred_language: string | null
          role: string
          time_format: string | null
          timezone: string | null
          uom_system: string | null
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string | null
          date_format?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          org_id: number
          phone?: string | null
          preferred_language?: string | null
          role: string
          time_format?: string | null
          timezone?: string | null
          uom_system?: string | null
        }
        Update: {
          avatar_path?: string | null
          created_at?: string | null
          date_format?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          org_id?: number
          phone?: string | null
          preferred_language?: string | null
          role?: string
          time_format?: string | null
          timezone?: string | null
          uom_system?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          abbreviation: string
          code: string
          color_token: string
          display_order: number
          id: number
          label: string
        }
        Insert: {
          abbreviation: string
          code: string
          color_token: string
          display_order: number
          id?: number
          label: string
        }
        Update: {
          abbreviation?: string
          code?: string
          color_token?: string
          display_order?: number
          id?: number
          label?: string
        }
        Relationships: []
      }
      service_logs: {
        Row: {
          carrier_org_id: number | null
          cost: number | null
          created_at: string | null
          id: number
          logged_by: string | null
          notes: string | null
          odometer: number | null
          receipt_path: string | null
          service_date: string
          service_type: string
          shop_name: string | null
          vehicle_id: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          cost?: number | null
          created_at?: string | null
          id?: number
          logged_by?: string | null
          notes?: string | null
          odometer?: number | null
          receipt_path?: string | null
          service_date: string
          service_type: string
          shop_name?: string | null
          vehicle_id?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          cost?: number | null
          created_at?: string | null
          id?: number
          logged_by?: string | null
          notes?: string | null
          odometer?: number | null
          receipt_path?: string | null
          service_date?: string
          service_type?: string
          shop_name?: string | null
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "service_logs_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_logs_truck_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      tiers: {
        Row: {
          code: string
          included_trucks: number
          label: string
          monthly_price: number
          price_per_additional_truck: number
          rank: number
        }
        Insert: {
          code: string
          included_trucks: number
          label: string
          monthly_price: number
          price_per_additional_truck: number
          rank: number
        }
        Update: {
          code?: string
          included_trucks?: number
          label?: string
          monthly_price?: number
          price_per_additional_truck?: number
          rank?: number
        }
        Relationships: []
      }
      vehicle_classifications: {
        Row: {
          code: string
          display_order: number
          id: number
          label: string
          license_category_note: string | null
          max_weight_kg: number | null
          min_weight_kg: number | null
          region: string
          requires_special_license: boolean
          scheme_name: string
        }
        Insert: {
          code: string
          display_order: number
          id?: number
          label: string
          license_category_note?: string | null
          max_weight_kg?: number | null
          min_weight_kg?: number | null
          region: string
          requires_special_license?: boolean
          scheme_name: string
        }
        Update: {
          code?: string
          display_order?: number
          id?: number
          label?: string
          license_category_note?: string | null
          max_weight_kg?: number | null
          min_weight_kg?: number | null
          region?: string
          requires_special_license?: boolean
          scheme_name?: string
        }
        Relationships: []
      }
      vehicle_documents: {
        Row: {
          carrier_org_id: number | null
          created_at: string | null
          doc_type: string
          expiry_date: string | null
          id: number
          label: string | null
          storage_path: string
          uploaded_by: string | null
          vehicle_id: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          created_at?: string | null
          doc_type: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          storage_path: string
          uploaded_by?: string | null
          vehicle_id?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          created_at?: string | null
          doc_type?: string
          expiry_date?: string | null
          id?: number
          label?: string | null
          storage_path?: string
          uploaded_by?: string | null
          vehicle_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "truck_documents_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "truck_documents_truck_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "truck_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_type_classifications: {
        Row: {
          classification_id: number
          vehicle_type_id: number
        }
        Insert: {
          classification_id: number
          vehicle_type_id: number
        }
        Update: {
          classification_id?: number
          vehicle_type_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_type_classifications_classification_id_fkey"
            columns: ["classification_id"]
            isOneToOne: false
            referencedRelation: "vehicle_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_type_classifications_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_types: {
        Row: {
          code: string
          display_order: number
          generic_photo_path: string | null
          icon: string
          id: number
          label: string
          specialized_capacity_note: string | null
          typical_cargo_volume_cuft: number | null
          typical_length_ft: number | null
          typical_payload_capacity_lbs: number | null
        }
        Insert: {
          code: string
          display_order: number
          generic_photo_path?: string | null
          icon: string
          id?: number
          label: string
          specialized_capacity_note?: string | null
          typical_cargo_volume_cuft?: number | null
          typical_length_ft?: number | null
          typical_payload_capacity_lbs?: number | null
        }
        Update: {
          code?: string
          display_order?: number
          generic_photo_path?: string | null
          icon?: string
          id?: number
          label?: string
          specialized_capacity_note?: string | null
          typical_cargo_volume_cuft?: number | null
          typical_length_ft?: number | null
          typical_payload_capacity_lbs?: number | null
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          cab_type: string | null
          carrier_org_id: number
          color: string | null
          created_at: string | null
          dimensions: string | null
          id: number
          is_active: boolean | null
          license_plate: string | null
          license_state: string | null
          make: string | null
          model: string | null
          nickname: string
          photo_path: string | null
          status: string
          vehicle_number: string | null
          vehicle_type_id: number
          vin: string | null
          year: number | null
        }
        Insert: {
          cab_type?: string | null
          carrier_org_id: number
          color?: string | null
          created_at?: string | null
          dimensions?: string | null
          id?: number
          is_active?: boolean | null
          license_plate?: string | null
          license_state?: string | null
          make?: string | null
          model?: string | null
          nickname: string
          photo_path?: string | null
          status?: string
          vehicle_number?: string | null
          vehicle_type_id: number
          vin?: string | null
          year?: number | null
        }
        Update: {
          cab_type?: string | null
          carrier_org_id?: number
          color?: string | null
          created_at?: string | null
          dimensions?: string | null
          id?: number
          is_active?: boolean | null
          license_plate?: string | null
          license_state?: string | null
          make?: string | null
          model?: string | null
          nickname?: string
          photo_path?: string | null
          status?: string
          vehicle_number?: string | null
          vehicle_type_id?: number
          vin?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trucks_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      loads_driver_view: {
        Row: {
          carrier_org_id: number | null
          commodity: string | null
          created_at: string | null
          customer_name_raw: string | null
          customer_org_id: number | null
          delivery_address: string | null
          delivery_city: string | null
          delivery_date: string | null
          delivery_lat: number | null
          delivery_lng: number | null
          delivery_state: string | null
          delivery_time: string | null
          delivery_zip: string | null
          driver_id: number | null
          id: number | null
          intake_method: string | null
          last_location_at: string | null
          last_location_lat: number | null
          last_location_lng: number | null
          load_number: string | null
          pickup_address: string | null
          pickup_city: string | null
          pickup_date: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          pickup_state: string | null
          pickup_time: string | null
          pickup_zip: string | null
          status: string | null
          total_miles: number | null
          tracking_token: string | null
          truck_id: number | null
          updated_at: string | null
          weight_lbs: number | null
        }
        Insert: {
          carrier_org_id?: number | null
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          id?: number | null
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number?: string | null
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          truck_id?: number | null
          updated_at?: string | null
          weight_lbs?: number | null
        }
        Update: {
          carrier_org_id?: number | null
          commodity?: string | null
          created_at?: string | null
          customer_name_raw?: string | null
          customer_org_id?: number | null
          delivery_address?: string | null
          delivery_city?: string | null
          delivery_date?: string | null
          delivery_lat?: number | null
          delivery_lng?: number | null
          delivery_state?: string | null
          delivery_time?: string | null
          delivery_zip?: string | null
          driver_id?: number | null
          id?: number | null
          intake_method?: string | null
          last_location_at?: string | null
          last_location_lat?: number | null
          last_location_lng?: number | null
          load_number?: string | null
          pickup_address?: string | null
          pickup_city?: string | null
          pickup_date?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          pickup_state?: string | null
          pickup_time?: string | null
          pickup_zip?: string | null
          status?: string | null
          total_miles?: number | null
          tracking_token?: string | null
          truck_id?: number | null
          updated_at?: string | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loads_carrier_org_id_fkey"
            columns: ["carrier_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_customer_org_id_fkey"
            columns: ["customer_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loads_truck_id_fkey"
            columns: ["truck_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      create_customer_org: {
        Args: {
          p_address?: string
          p_city?: string
          p_contact_name?: string
          p_country?: string
          p_email?: string
          p_name: string
          p_notes?: string
          p_phone?: string
          p_state?: string
          p_zip?: string
        }
        Returns: {
          customer_number: string
          name: string
          org_id: number
        }[]
      }
      driver_self_update_allowed: {
        Args: {
          p_active: boolean
          p_cdl_expiry: string
          p_med_expiry: string
          p_number: string
          p_org: number
        }
        Returns: boolean
      }
      get_public_tracking: {
        Args: { p_token: string }
        Returns: {
          carrier_email: string
          carrier_name: string
          carrier_phone: string
          delivery_city: string
          delivery_date: string
          delivery_state: string
          last_location_at: string
          last_location_lat: number
          last_location_lng: number
          load_number: string
          pickup_city: string
          pickup_date: string
          pickup_state: string
          status: string
        }[]
      }
      get_public_tracking_events: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          event_type: string
        }[]
      }
      has_feature: { Args: { feature_key: string }; Returns: boolean }
      mark_overdue_invoices: { Args: never; Returns: number }
      my_org_id: { Args: never; Returns: number }
      my_role: { Args: never; Returns: string }
      next_entity_val: {
        Args: { carrier_org_bigint: number; entity_name: string }
        Returns: number
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

