import type { ProjectMetadata } from 'web-mapper'
import IndexedDBStorage from '../../web-mapper/src/storage/indexdb'

interface ProjectSelectionCallbacks {
  onProjectSelected: (projectId: string) => void
  onProjectCreated: (name: string) => void
}

export class ProjectSelection {
  private storage: IndexedDBStorage
  private callbacks: ProjectSelectionCallbacks
  private container: HTMLDivElement
  private inputElement: HTMLInputElement | null = null

  constructor(storage: IndexedDBStorage, callbacks: ProjectSelectionCallbacks) {
    this.storage = storage
    this.callbacks = callbacks
    this.container = this.createUI()
  }

  private createUI(): HTMLDivElement {
    const container = document.createElement('div')
    container.className = 'project-selection-overlay'
    container.innerHTML = `
      <div class="project-selection">
        <h1>Trees Mapper</h1>
        <p>Select a project or create a new one</p>

        <div class="project-input-container">
          <input
            type="text"
            placeholder="Enter project name..."
            class="project-input"
            id="project-name-input"
          />
          <button class="create-project-button">Create Project</button>
        </div>

        <div class="project-list" id="project-list">
          <!-- Projects will be inserted here -->
        </div>
      </div>
    `

    // Get references to elements
    this.inputElement = container.querySelector('#project-name-input')
    const createButton = container.querySelector('.create-project-button')

    // Setup event listeners
    if (this.inputElement) {
      this.inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.handleCreateProject()
        }
      })
    }

    if (createButton) {
      createButton.addEventListener('click', () => {
        this.handleCreateProject()
      })
    }

    // Load and display projects
    this.loadProjects()

    return container
  }

  private async handleCreateProject() {
    const name = this.inputElement?.value.trim()
    if (!name) {
      alert('Please enter a project name')
      return
    }

    this.callbacks.onProjectCreated(name)
  }

  private async loadProjects() {
    const projects = await this.storage.listProjects()
    const projectList = this.container.querySelector('#project-list')

    if (!projectList) return

    if (projects.length === 0) {
      projectList.innerHTML = '<p class="no-projects">No projects yet. Create your first project above!</p>'
      return
    }

    projectList.innerHTML = `
      <h3>Recent Projects</h3>
      <div class="project-items">
        ${projects.map(project => this.createProjectItem(project)).join('')}
      </div>
    `

    // Attach click handlers
    projects.forEach(project => {
      const element = projectList.querySelector(`[data-project-id="${project.id}"]`)
      if (element) {
        element.addEventListener('click', (e) => {
          const target = e.target as HTMLElement
          // Don't trigger if clicking delete button
          if (!target.classList.contains('delete-button')) {
            this.callbacks.onProjectSelected(project.id)
          }
        })

        // Delete button handler
        const deleteButton = element.querySelector('.delete-button')
        if (deleteButton) {
          deleteButton.addEventListener('click', async (e) => {
            e.stopPropagation()
            if (confirm(`Delete project "${project.name}"?`)) {
              await this.storage.deleteProject(project.id)
              await this.loadProjects() // Refresh list
            }
          })
        }
      }
    })
  }

  private createProjectItem(project: ProjectMetadata): string {
    const timeAgo = this.formatRelativeTime(project.lastModified)
    const thumbnail = project.thumbnail || ''

    return `
      <div class="project-item" data-project-id="${project.id}">
        ${thumbnail ? `<img src="${thumbnail}" class="project-thumbnail" alt="${project.name}" />` : '<div class="project-thumbnail-placeholder"></div>'}
        <div class="project-info">
          <div class="project-name">${this.escapeHtml(project.name)}</div>
          <div class="project-time">${timeAgo}</div>
        </div>
        <button class="delete-button" title="Delete project">×</button>
      </div>
    `
  }

  private formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / (60 * 1000))
    const hours = Math.floor(diff / (60 * 60 * 1000))
    const days = Math.floor(diff / (24 * 60 * 60 * 1000))

    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 30) return `${days}d ago`
    return new Date(timestamp).toLocaleDateString()
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  show() {
    document.body.appendChild(this.container)
    // Focus the input
    setTimeout(() => this.inputElement?.focus(), 100)
  }

  hide() {
    this.container.remove()
  }

  destroy() {
    this.hide()
  }
}
