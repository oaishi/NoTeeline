import create from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export type NotePoint = {
    point: string;
    created_at: number;
    utc_time: number;
    // updated_at: number;
}

export type TranscriptLine = {
    offset: number;
    duration: number;
    text: string;
}

export type Note_t = {
    name: string;
    ytId: string;
    micronote: boolean;
    content: NotePoint[];
    transcription: TranscriptLine[];
    expansion: ExpandedNote[];
    generatedSummary: string;
    generatedSummary_P: string;
    theme_count: number; //how many times theme-order button is clicked
    time_count: number; //how many times time-order button is clicked
    expand_count: number; //how many times expand-all button is clicked
    created_at: number;
    updated_at: number;
    recording_start: number;
}

export type ExpandedNote = {
    point: string;
    expansion: string;
}

export type OnboardingSection = {
    id: number;
    note: string;
    keypoints: string[];
    transcript: string;
}

type NoteStore_t = {
    notes: Note_t[];
    onboardings: OnboardingSection[];
    addOnboarding: (onboarding: OnboardingSection) => void;
    fetchAllOnboardings: () => OnboardingSection[];
    addNote: (note: Note_t) => void;
    fetchNote: (name: string) => Note_t;
    addYouTubeId: (name: string, ytId: string) => void;
    addTranscription: (name: string, transcription: TranscriptLine[]) => void;
    addExpansion: (name: string, expandedNote: ExpandedNote) => void;
    checkUniqueName: (name: string) => boolean;
    updateNote: (name: string, content: NotePoint[]) => void;
    updateNoteName: (oldName: string, newName: string) => void;
    removeNote: (note: Note_t) => void;
    startRecording: (name: string, time: number) => void;
    computeButtonClick: (name: string, type: string) => void;
    fetchButtonStats: (name: string) => { theme_count: number, expand_count: number, time_count: number };
    addSummary: (name: string, summary: string) => void;
    addSummary_P: (name: string, summary: string) => void;
}

/**
 * Zustand store for notes
 * -----------------------
 * note:            object with name and content
 *  name:               string(should be unique)
 *  content:            array of strings(bullet points)
 * notes:           array of notes 
 * addNote:         function to add a note to the notes array
 * checkUniqueName: function to check if the name of the note is unique
 * updateNote:      function to update a note in the notes array(on every bullet point addition/deletion)
 * removeNote:      function to remove a note from the notes array
 */

const NoteStore = (set: any, get: any) =>({
    notes: [] as Note_t[],
    onboardings: [] as OnboardingSection[],
    addOnboarding: (onboarding: OnboardingSection) => {
        set((state: any) => {
            if(state.onboardings.length < 3) {
                return { onboardings: [...state.onboardings, onboarding] }
            }else{
                const updatedOnboardings = state.onboardings.map((ob: OnboardingSection) => {
                    if(ob.id === onboarding.id) {
                        return onboarding
                    }else{
                        return ob
                    }
                })
                return { onboardings: updatedOnboardings, }
            }
        })
    },
    fetchAllOnboardings: () => {
        return get().onboardings
    },
    addNote: (note: Note_t) => set((state: any) => {
        if(note.name == "Demo Note") return { notes: [note, ...state.notes] }

        return { notes: [...state.notes, note]}
    }),
    fetchNote: (name: string) => {
        const note = get().notes.find((note: Note_t) => note.name === name)
        return note ? note : null
    },
    addYouTubeId: (name: string, ytId: string) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    return {...n, ytId: ytId}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    addTranscription: (name: string, transcription: TranscriptLine[]) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    return {...n, transcription: transcription}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    addExpansion: (name: string, expandedNote: ExpandedNote) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    return {...n, expansion: [...n.expansion, expandedNote]}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    checkUniqueName: (name: string) => {
        const isUnique = get().notes.filter((note: Note_t) => note.name === name).length === 0
        return isUnique ? true : false
    },
    updateNote: (name: string, content: NotePoint[]) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    return {...n, content: content}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    updateNoteName: (oldName: string, newName: string) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === oldName) {
                    return {...n, name: newName}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    removeNote: (note: Note_t) => {
        set((state: any) => {
            const updatedNotes = state.notes.filter((n: Note_t) => n.name !== note.name)
            return { notes: updatedNotes, }
        })
    },
    startRecording: (name: string, time: number) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    return {...n, recording_start: time}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    computeButtonClick: (name: string, type: string) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    if(type === 'theme'){
                        let c = n.theme_count
                        return {...n, theme_count: c+1}
                    }else if(type === 'expand'){
                        let c = n.expand_count
                        return {...n, expand_count: c+1}
                    }else if(type === 'time'){
                        let c = n.time_count
                        return {...n, time_count: c+1}
                    }
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    fetchButtonStats: (name: string) => {
        const note = get().notes.find((note: Note_t) => note.name === name)
        return note ? { theme_count: note.theme_count, expand_count: note.expand_count, time_count: note.time_count } : null
    },
    addSummary: (name: string, summary: string) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    return {...n, generatedSummary: summary}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
    addSummary_P: (name: string, summary: string) => {
        set((state: any) => {
            const updatedNotes = state.notes.map((n: Note_t) => {
                if(n.name === name) {
                    return {...n, generatedSummary_P: summary}
                }
                return n
            })
            return { notes: updatedNotes, }
        })
    },
})

export const useNoteStore = create<NoteStore_t>(devtools(persist(NoteStore, { name: 'note-store' })))