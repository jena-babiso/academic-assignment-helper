// backend/services/n8nService.js - UPDATED FOR SUPABASE + PROJECT REQUIREMENTS
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const db = require('../config/db'); // Supabase client

class N8NService {
  constructor() {
    this.n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/assignment';
    this.enabled = process.env.N8N_ENABLED === 'true';
    this.workflowTimeout = 45000; // 45 seconds for full RAG + AI workflow
  }

  /**
   * Trigger complete n8n workflow for assignment processing - UPDATED FOR PROJECT SPECS
   */
  async triggerFullWorkflow(assignmentData) {
    if (!this.enabled) {
      console.log('n8n integration disabled - skipping workflow');
      return { success: true, skipped: true, reason: 'n8n_disabled' };
    }

    try {
      // UPDATED: Prepare data according to project requirements
      const payload = {
        // Workflow Identification
        event: 'assignment_analysis_workflow',
        workflow: 'academic_assignment_analysis',
        timestamp: new Date().toISOString(),
        
        // Assignment Metadata (REQUIRED BY PROJECT SPECS)
        assignment_id: assignmentData.assignmentId,
        student_id: assignmentData.studentId,
        filename: assignmentData.filename,
        file_path: assignmentData.filePath, // For text extraction in n8n
        extracted_text: assignmentData.text, // Already extracted text
        
        // Analysis Data
        word_count: assignmentData.wordCount,
        upload_timestamp: assignmentData.uploadTimestamp,
        
        // Initial Analysis from Local Processing
        initial_analysis: assignmentData.basicAnalysis,
        
        // Processing Instructions for n8n (PROJECT REQUIREMENTS)
        processing_steps: [
          'text_extraction',        // Extract text from file (pdf-parse/mammoth)
          'rag_source_search',      // Query vector database for relevant sources
          'ai_analysis',            // DeepSeek analysis with RAG context
          'plagiarism_detection',   // Compare against academic database
          'results_storage',        // Store structured results in PostgreSQL
          'optional_notifications'  // Slack/email notifications
        ],
        
        // RAG Configuration
        rag_config: {
          vector_database: 'supabase_pgvector',
          embedding_model: 'text-embedding-ada-002',
          similarity_threshold: 0.7,
          max_sources: 5
        },
        
        // AI Analysis Configuration
        ai_config: {
          provider: 'deepseek',
          model: 'deepseek-chat',
          analysis_types: [
            'topic_extraction',
            'key_themes_identification', 
            'research_questions_identification',
            'academic_level_assessment',
            'source_suggestions',
            'citation_recommendations',
            'plagiarism_assessment'
          ]
        }
      };

      console.log(`🚀 Triggering n8n workflow for assignment ${assignmentData.assignmentId}`);
      console.log(`📊 Payload includes: ${assignmentData.wordCount} words, ${assignmentData.basicAnalysis.plagiarismScore}% plagiarism score`);
      
      const response = await axios.post(this.n8nWebhookUrl, payload, {
        timeout: this.workflowTimeout,
        headers: {
          'Content-Type': 'application/json',
          'X-N8N-Webhook': 'academic-assignment-helper',
          'X-API-Key': process.env.N8N_API_KEY || ''
        }
      });

      console.log('✅ n8n workflow triggered successfully');
      
      // UPDATED: Store workflow ID in Supabase
      if (response.data.workflow_id) {
        await this.updateWorkflowStatus(assignmentData.assignmentId, {
          n8n_workflow_id: response.data.workflow_id,
          n8n_triggered_at: new Date().toISOString(),
          n8n_status: 'triggered'
        });
      }

      return {
        success: true,
        workflowId: response.data.workflow_id || response.data.executionId,
        executionId: response.data.execution_id || response.data.workflowId,
        message: 'n8n workflow triggered successfully',
        estimated_completion: '2-3 minutes'
      };

    } catch (error) {
      console.error('❌ n8n workflow trigger failed:', error.message);
      
      // UPDATED: Log failure in Supabase
      await this.updateWorkflowStatus(assignmentData.assignmentId, {
        n8n_status: 'failed',
        n8n_error: error.message,
        n8n_failed_at: new Date().toISOString()
      });

      // Don't fail main upload - return graceful failure
      return {
        success: false,
        error: error.message,
        workflowStep: 'initial_trigger',
        skipped: true,
        suggestion: 'Check n8n server connectivity and webhook URL'
      };
    }
  }

  /**
   * UPDATED: Update workflow status in Supabase
   */
  async updateWorkflowStatus(assignmentId, updateData) {
    try {
      const { error } = await db
        .from('analysis_results')
        .update(updateData)
        .eq('assignment_id', assignmentId);

      if (error) throw error;
      
      console.log(`📝 Updated n8n status for assignment ${assignmentId}: ${updateData.n8n_status}`);
    } catch (error) {
      console.error('Failed to update n8n workflow status:', error.message);
    }
  }

  /**
   * Trigger specific workflow steps (modular approach) - UPDATED
   */
  async triggerWorkflowStep(stepName, stepData) {
    if (!this.enabled) return { success: true, skipped: true };

    try {
      const payload = {
        event: `academic_${stepName}`,
        timestamp: new Date().toISOString(),
        step: stepName,
        data: stepData
      };

      const response = await axios.post(`${this.n8nWebhookUrl}/${stepName}`, payload, {
        timeout: 15000,
        headers: {
          'X-N8N-Step': stepName
        }
      });

      return {
        success: true,
        step: stepName,
        result: response.data
      };

    } catch (error) {
      console.warn(`n8n step ${stepName} failed:`, error.message);
      return {
        success: false,
        step: stepName,
        error: error.message
      };
    }
  }

  /**
   * NEW: Process RAG search results from n8n and store in Supabase
   */
  async processRAGResults(assignmentId, ragResults) {
    try {
      const { data, error } = await db
        .from('analysis_results')
        .update({
          suggested_sources: ragResults.sources,
          rag_processed: true,
          rag_processed_at: new Date().toISOString()
        })
        .eq('assignment_id', assignmentId)
        .select();

      if (error) throw error;
      
      console.log(`✅ RAG results stored for assignment ${assignmentId}: ${ragResults.sources?.length || 0} sources`);
      return { success: true, sourcesCount: ragResults.sources?.length || 0 };
    } catch (error) {
      console.error('Failed to store RAG results:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * NEW: Process final analysis results from n8n workflow
   */
  async processFinalAnalysis(assignmentId, finalAnalysis) {
    try {
      const { data, error } = await db
        .from('analysis_results')
        .update({
          suggested_sources: finalAnalysis.suggested_sources,
          plagiarism_score: finalAnalysis.plagiarism_score,
          flagged_sections: finalAnalysis.flagged_sections,
          research_suggestions: finalAnalysis.research_suggestions,
          citation_recommendations: finalAnalysis.citation_recommendations,
          confidence_score: finalAnalysis.confidence_score,
          n8n_processed: true,
          n8n_completed_at: new Date().toISOString(),
          analyzed_at: new Date().toISOString()
        })
        .eq('assignment_id', assignmentId)
        .select();

      if (error) throw error;
      
      console.log(`✅ Final analysis stored for assignment ${assignmentId}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to store final analysis:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Health check with detailed n8n status - UPDATED
   */
  async healthCheck() {
    if (!this.enabled) {
      return { 
        status: 'disabled', 
        message: 'n8n integration is disabled in configuration',
        suggestion: 'Set N8N_ENABLED=true in .env to enable'
      };
    }

    try {
      // Try basic webhook connectivity test
      const testPayload = {
        event: 'health_check',
        timestamp: new Date().toISOString(),
        test: true
      };

      const response = await axios.post(this.n8nWebhookUrl, testPayload, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return {
        status: 'connected',
        message: 'n8n workflow engine is operational',
        webhook_url: this.n8nWebhookUrl,
        response_time: response.duration ? `${response.duration}ms` : 'unknown',
        enabled: this.enabled
      };

    } catch (error) {
      return {
        status: 'disconnected',
        message: 'n8n workflow engine is not reachable',
        webhook_url: this.n8nWebhookUrl,
        error: error.message,
        suggestion: 'Start n8n with: docker run -p 5678:5678 n8nio/n8n or check n8n.cloud'
      };
    }
  }

  /**
   * Get workflow execution status - UPDATED
   */
  async getWorkflowStatus(executionId) {
    if (!this.enabled) return { status: 'n8n_disabled' };

    try {
      // This would require n8n API endpoint - for now return basic status
      return {
        status: 'processing',
        execution_id: executionId,
        message: 'Workflow is being processed by n8n',
        estimated_completion: 'Check n8n interface for detailed status'
      };

    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }
}

module.exports = new N8NService();