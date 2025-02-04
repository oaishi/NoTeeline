/* eslint-disable */

import React, { useState, useEffect, useRef, } from 'react'
import { Grid, GridItem, Tag, TagRightIcon, TagLabel, Button, InputGroup, Input, InputRightElement, useToast, theme, keyframes } from '@chakra-ui/react'
import {
    SunIcon,
    ChevronRightIcon,
    ChevronLeftIcon,
    TimeIcon,
    DragHandleIcon,
    CalendarIcon,
    ArrowBackIcon,
    ArrowForwardIcon,
    EditIcon,
} from '@chakra-ui/icons'
import YouTube from 'react-youtube'
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd"

import { NotePoint, TranscriptLine, useNoteStore, Note_t } from '../state/noteStore'
import { openai, expandPoint, getFormattedPromptString, callGPT, generateQuiz, generateTheme, callGPTForSinglePoint, expandPointWithTranscript, generatepointsummary } from '../utils/helper'
import BulletPoint from './BulletPoint'
import Quiz, { Quiz_t } from './Quiz'

type NoteProps = {
    name: string;
    note: Note_t;
}

type bulletObject = {
    point: string;
    created_at: number;
    utc_time: number;
    editable: boolean;
    id: string;
    expand: number;
    compress: number;
    history: string[];
    edit: { e_point: string, e_time: number, }[][];
    state: number; // 0 for stable, 1 for expanding/reducing
    tempString: string; // string during streamlined output
    totalString: string;
}

let previousTime: number = 0
let forwardCount: number = 0
let reverseCount: number = 0

const CornellNote: React.FC<NoteProps> = ({ name, note }) => {
    const { updateNote, addYouTubeId, startRecording, addTranscription, computeButtonClick, fetchButtonStats, addSummary, addSummary_P } = useNoteStore((state) => ({
        updateNote: state.updateNote,
        addYouTubeId: state.addYouTubeId,
        startRecording: state.startRecording,
        addTranscription: state.addTranscription,
        computeButtonClick: state.computeButtonClick,
        fetchButtonStats: state.fetchButtonStats,
        addSummary: state.addSummary,
        addSummary_P: state.addSummary_P,
    }))
    const [micronote, setMicronote] = useState<boolean>(true)
    const [bulletPoints, setBulletPoints] = useState<bulletObject[]>([])
    const [newPoint, setNewPoint] = useState<string>('')
    const [newTitle, setNewTitle] = useState<string>('')
    const [ytLink, setYtLink] = useState<string>('')
    const [embedId, setEmbedId] = useState<string>('')
    const [isLink, setIsLink] = useState<boolean>(false)
    const [transcription, setTranscription] = useState<TranscriptLine[]>([]) //yt transcription
    const [playerTime, setPlayerTime] = useState<number>(0) //time of the yt player at any instant
    const [, setPause] = useState<boolean>(false)
    const [expandSection, setExpandSection] = useState<boolean>(true) //show only note section by default
    const [expandQuizSection, setExpandQuizSection] = useState<boolean>(false)
    const [dragging, setDragging] = useState(false)
    const [draggingIndex, setDraggingIndex] = useState<number>(-1)
    const [initialY, setInitialY] = useState(0)
    const [expandButtonToggle, setExpandButtonToggle] = useState<boolean>(false)
    const [showQuiz, setShowQuiz] = useState<number>(0) // 0->no quiz, 1->called openai, 2->quiz visible
    const [showSummary, setShowSummary] = useState<boolean>(false)
    const [summary, setSummary] = useState<string>('')
    const [summary_p, setSummary_P] = useState<string>('')
    const [themeOrTime, setThemeOrTime] = useState<string>('theme')
    const [quizzes, setQuizzes] = useState<Quiz_t[]>([])
    const [quizInfo, setQuizInfo] = useState<any>(null)
    const [themes, setThemes] = useState<any>([])
    const [pauseCount, setPauseCount] = useState<number>(0)
    const [opts, setOpts] = useState<any>({
        height: '400',
        width: '80%',
        frameborder: '0',
        playerVars: { autoplay: 0, },
    })

    const ref = useRef(null)
    const toast = useToast()
    let timeoutHandle: any

    const js_sleep = (ms: number | undefined) => {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    const OPEN_AI_KEY = JSON.parse(localStorage.getItem('gptKey'))
    const SLEEP_DELAY = 150

    const streamViewHelper = (index: number, text: string) => {
        const newPoints = [...bulletPoints]
        newPoints[index].tempString = text
        if (index === 0) console.log(`Sent => ${text}`)
        setBulletPoints(newPoints)
    }

    const genResponses = async (points: { point: string, history: string[], expand: number, created_at: number, utc_time: number, }[], transcription: TranscriptLine[]) => {
        const promptString = getFormattedPromptString()
        const responses = await Promise.all(
            points.map(async (point, idx) => {
                try {
                    if (point.history.length > point.expand) {
                        console.log(`${point.history.length}, ${point.expand}`)
                    } else {
                        const pointToBeExpanded = point.history[point.expand - 1]
                        const expandedPoint = expandPoint({ point: pointToBeExpanded, created_at: point.created_at, utc_time: point.utc_time, }, transcription)
                        const transcript = expandedPoint.transcript.join(".")
                        const PROMPT = "Expand the provided keypoint into a one sentence note.\n" +
                            "Transcript: ..." + transcript + "...\n" +
                            "Keypoint: " + expandedPoint.point + "\n" +
                            "Note:"

                        const res = await fetch('https://api.openai.com/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${OPEN_AI_KEY}`,
                            },
                            body: JSON.stringify({
                                model: 'gpt-4-turbo',
                                messages: [{ role: 'system', content: promptString }, { role: 'user', content: PROMPT }],
                                stream: true,
                                seed: 1,
                                temperature: 0.5,
                            }),
                        })

                        const reader = res.body.getReader()
                        const decoder = new TextDecoder('utf-8')
                        let response = ''

                        while (true) {
                            const chunk = await reader.read()
                            const { done, value } = chunk
                            if (done) {
                                break
                            }
                            const decodedChunk = decoder.decode(value)
                            const lines = decodedChunk.split('\n')
                            const parsedLines = lines.map(line => line.replace(/^data: /, '').trim()).filter(line => line !== '' && line !== '[DONE]').map(line => JSON.parse(line))

                            for (const parsedLine of parsedLines) {
                                const { choices } = parsedLine
                                const { delta } = choices[0]
                                const { content } = delta
                                if (content) {
                                    response += content
                                    streamViewHelper(idx, content)
                                    await js_sleep(SLEEP_DELAY)
                                }
                            }

                        }
                        return response
                    }
                } catch (e) {
                    console.log('Error ' + e)
                }
            })
        )

        let rep: (string | undefined)[] = []
        responses.forEach((response, index) => {
            rep.push(response)
        })

        return rep
    }

    // streaming openai exapnsion outputs for all points
    const testDrive = async () => {
        if (!expandButtonToggle) {
            toast({
                title: 'Expanding all the points...',
                description: 'Please wait while we expand the bullet points',
                status: 'info',
                duration: 5000,
                position: 'top-right',
                isClosable: true,
            })
        } else {
            toast({
                title: 'Reducing all the points...',
                description: 'Please wait while we reduce the bullet points',
                status: 'info',
                duration: 2000,
                position: 'top-right',
                isClosable: true,
            })
        }

        const newPoints = [...bulletPoints]

        if (!expandButtonToggle) newPoints.map((point: bulletObject) => point.expand = point.expand + 1)
        else newPoints.map((point: bulletObject) => point.expand = point.expand >= 1 ? point.expand - 1 : 0)
        newPoints.map((point: bulletObject) => point.state = 1)
        const points = bulletPoints.map((point: bulletObject) => ({
            point: point.point,
            history: point.history,
            expand: point.expand,
            created_at: point.created_at,
            utc_time: point.utc_time,
        }))

        setBulletPoints(newPoints)
        console.log('expand button: ' + expandButtonToggle)

        if (!expandButtonToggle) {
            genResponses(points, transcription).then(res => {
                console.log('Done expanding ...')
                const ret = newPoints.map((newPoint, idx) => {
                    let edit: { e_point: string, e_time: number, }[][] = [...newPoint.edit]
                    edit.push([])
                    edit[newPoint.expand].push({ e_point: res[idx], e_time: Date.now() })
                    return {
                        ...newPoint,
                        history: [...newPoint.history, res[idx]],
                        edit: edit,
                        state: 0,
                        tempString: '',
                        totalString: '',
                    }
                })

                setExpandButtonToggle(!expandButtonToggle)
                setBulletPoints(ret)
                computeButtonClick(newTitle, 'expand')

            })
        }
    }

    useEffect(() => {
        console.log(window.innerWidth, window.innerHeight)
        const iw = window.innerWidth

        setOpts((prev: any) => ({...prev, height: 0.4559 * window.innerHeight, width: 0.5 * window.innerWidth, }))

        setNewTitle(name)
        setMicronote(note.micronote)
        setExpandButtonToggle(false)
        setShowSummary(false)
        setSummary('')
        setSummary_P('')
        setThemes([])
        setThemeOrTime('theme')
        setPauseCount(0)
        setQuizzes([])

        if (note?.ytId !== '') {
            setEmbedId(note.ytId)
            setIsLink(true)

            if (note?.transcription.length === 0) {
                getYoutubeTranscription(note.ytId);
            }
        } else {
            setEmbedId('')
            setIsLink(false)
        }

        if (note?.transcription) {
            setTranscription(note.transcription)
        }

        if (note?.generatedSummary !== '') {
            setSummary(note.generatedSummary)
        }

        if (note?.generatedSummary_P !== '') {
            setSummary_P(note.generatedSummary_P)
            setShowSummary(true)
        }

        startRecording(name, Date.now())

        const points = note.content?.map((cont: NotePoint, idx: number) => ({
            ...cont,
            editable: false,
            id: `bullet-${idx}`,
            expand: 0,
            compress: 0,
            history: [cont.point],
            edit: [[{ e_point: cont.point, e_time: cont.utc_time, }]],
            state: 0,
            tempString: '',
            totalString: '',
        }))

        let pointStreams: string[] = []
        points.map(() => pointStreams.push(''))
        localStorage.setItem('pointStreams', JSON.stringify(pointStreams))

        setBulletPoints(points)

        const handler = (e: Event) => e.preventDefault()
        document.addEventListener('gesturestart', handler)
        document.addEventListener('gesturechange', handler)
        document.addEventListener('gestureend', handler)

        return () => {
            document.removeEventListener('gesturestart', handler)
            document.removeEventListener('gesturechange', handler)
            document.removeEventListener('gestureend', handler)
        }
    }, [name])

    //when a new point is typed and 'enter' is pressed
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault()

            const time_now = Date.now()

            const updatedPoints = bulletPoints.map((point: bulletObject) => {
                return {
                    point: point.point,
                    created_at: point.created_at,
                    utc_time: point.utc_time,
                }
            })

            const np = {
                point: newPoint,
                created_at: playerTime, //time of the yt player at the moment of pressing enter
                utc_time: time_now,
            }

            const maxId = Math.max(...bulletPoints.map((point: bulletObject) => parseInt(point.id.split('-')[1])))

            updatedPoints.push(np)

            updateNote(newTitle, updatedPoints)
            setBulletPoints([
                ...bulletPoints,
                {
                    ...np,
                    editable: false,
                    id: `bullet-${maxId}`,
                    expand: 0,
                    compress: 0,
                    history: [newPoint],
                    edit: [[{ e_point: newPoint, e_time: time_now, }]],
                },
            ])
            let pointStreams = JSON.parse(localStorage.getItem('pointStreams') ?? '""') //adding a stream tracker for a new point
            pointStreams.push('')
            localStorage.setItem('pointStreams', JSON.stringify(pointStreams))
            setNewPoint('')
        }
    }

    //marks a bullet point as 'editable: true'
    const editPoint = (id: number) => {
        const newPoints = [...bulletPoints]
        newPoints[id].editable = true
        setBulletPoints(newPoints)
    }

    //instantly changes an editable bullet point's state when typed on input
    const changeEditPoint = (index: number, val: string) => {
        const newPoints = bulletPoints.map((bulletPoint, idx) => {
            if (idx === index) {
                let history = [...bulletPoint.history]
                history[bulletPoint.expand] = val //changing the point itself

                return {
                    ...bulletPoint,
                    history: history,
                }
            } else {
                return bulletPoint
            }
        })

        setBulletPoints(newPoints)
    }

    //makes an editable bullet point to uneditable
    const updateEditPoint = (index: number, event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault()
            const newPoints = [...bulletPoints]
            newPoints[index].editable = false
            const latestEdit = newPoints[index].history[newPoints[index].expand]
            newPoints[index].edit[newPoints[index].expand].push({ e_point: latestEdit, e_time: Date.now() })
            setBulletPoints(newPoints)
            updateNote(newTitle, bulletPoints.map((point: bulletObject) => ({ point: point.point, created_at: point.created_at, utc_time: point.utc_time })))
        }
    }

    const getYoutubeTranscription = (youtubeId: string = '') => {
        console.log(`youtubeid: ${youtubeId}`)
        let ytId = youtubeId
        if (ytLink.includes('watch')) {
            ytId = ytLink.split('v=')[1]
            setEmbedId(ytId)
            setIsLink(true)
        } else if (ytLink.includes('youtu.be')) {
            ytId = ytLink.split('/')[3].split('?')[0]
            setEmbedId(ytId)
            setIsLink(true)
        } else if (ytId === '') {
            alert('Invalid YouTube link!')
            // return
        }

        if (youtubeId === '') addYouTubeId(name, ytId)

        fetch('https://noteeline-backend.onrender.com/youtube-transcript', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ytLink: `https://www.youtube.com/watch?v=${ytId}`,
            }),
        }).then(res => res.json()).then(d => {
            console.log(d) //each transctiption => {start, duration, text}
            if (!d) {
                toast({
                    title: 'Warning',
                    description: 'The provided YouTube video does not have a transcription or has it disabled!',
                    status: 'warning',
                    duration: 5000,
                    isClosable: true,
                })
            } else {
                const resp: { text: string, start: number, duration: number }[] = d
                const response = Array.isArray(resp) ? resp.map(({ text, start, duration }) => ({
                    text,
                    offset: start,
                    duration
                })) : []
                const response2 = d.map(({ text, start, duration }) => ({
                    text,
                    offset: start,
                    duration
                }))

                console.log ( response )
                console.log ( response2 )
                
                addTranscription(name, response)
                setTranscription(response)

                //generating summary from transcript
                let tr = ''
                const res_tr = response
                for (let i = 0; i < res_tr.length; i++) {
                    tr += res_tr[i].text
                }

                //http://localhost:3000/fetch-summary
                fetch('https://noteeline-backend.onrender.com/fetch-summary', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        transcript: tr
                    }),
                }).then(res => res.json()).then(data => {
                    console.log('Summary from transcription:')
                    console.log(data)
                    setSummary(data.response)
                    addSummary(newTitle, data.response)
                }).catch(e => console.log(e))
            }
        }).catch(err => {
            console.log(err)
            toast({
                title: 'Error',
                description: 'Error in transcribing your YouTube video!',
                status: 'error',
                duration: 5000,
                isClosable: true,
            })
        })
    }

    const handleVideoStateChange = (e: any) => {
        const time = e.target.getCurrentTime() // time: number
        const playerState = e.target.getPlayerState() //playerState: number

        if (playerState === 1) {
            setPlayerTime(time)
            const D = time - previousTime
            previousTime = time
            const epsilon = 2
            if (Math.abs(D) > epsilon) {
                if (D > 0) {
                    forwardCount += 1
                }
                else {
                    reverseCount += 1
                }
            }
        }
        timeoutHandle = window.setTimeout(() => handleVideoStateChange(e), 1000)
    }

    const loop = (e: any) => {
        timeoutHandle = window.setTimeout(() => handleVideoStateChange(e), 1000)
    }

    const stopVideo = () => {
        window.clearTimeout(timeoutHandle)
    }

    const countPause = () => {
        setPauseCount((prevCount) => prevCount + 1)
        setPause(true)
        // console.log(`pause: ${pauseCount+1}`)
    }

    //expand all points at a time
    const expandNote = async () => {
        if (!expandButtonToggle) {
            toast({
                title: 'Expanding all the points...',
                description: 'Please wait while we expand the bullet points',
                status: 'info',
                duration: 5000,
                position: 'top-right',
                isClosable: true,
            })
        } else {
            toast({
                title: 'Reducing all the points...',
                description: 'Please wait while we reduce the bullet points',
                status: 'info',
                duration: 2000,
                position: 'top-right',
                isClosable: true,
            })
        }

        // setExpanding(0)

        const newPoints = [...bulletPoints]

        if (!expandButtonToggle) newPoints.map((point: bulletObject) => point.expand = point.expand + 1)
        else newPoints.map((point: bulletObject) => point.expand = point.expand >= 1 ? point.expand - 1 : 0)

        const points = bulletPoints.map((point: bulletObject) => ({
            point: point.point,
            history: point.history,
            expand: point.expand,
            created_at: point.created_at,
            utc_time: point.utc_time,
        }))

        setBulletPoints(newPoints)
        console.log('expand button: ' + expandButtonToggle)

        if (!expandButtonToggle) {
            callGPT(points, transcription).then(res => {
                if (res) {

                    const ret = newPoints.map((newPoint, idx) => {
                        if (res[idx].old) {
                            return newPoint
                        } else {
                            let edit: { e_point: string, e_time: number, }[][] = [...newPoint.edit]
                            edit.push([])
                            edit[newPoint.expand].push({ e_point: res[idx].expansion, e_time: Date.now() })
                            return {
                                ...newPoint,
                                history: [...newPoint.history, res[idx].expansion],
                                edit: edit,
                            }
                        }
                    })

                    setExpandButtonToggle(!expandButtonToggle)
                    setBulletPoints(ret)
                    computeButtonClick(newTitle, 'expand')

                    // ripple effect of expansion onto the themes if they exist
                    if (themes.length > 0) {
                        const newThemes = themes.map((theme: { type: string, val: string, editable: boolean }, index: number) => {
                            if (theme['type'] === 'point') {
                                const val = theme['val']
                                const idxVal = newPoints.findIndex((point: bulletObject) => point.point === val)
                                return {
                                    ...theme,
                                    val: ret[idxVal].history[ret[idxVal].expand]
                                }
                            } else {
                                return theme
                            }
                        })

                        console.log('Expanded themes:')
                        console.log(newThemes)
                        setThemes(newThemes)
                    }
                    // console.log(res)
                    // setExpandButtonToggle(!expandButtonToggle)
                } else {
                    toast({
                        title: 'Error...',
                        description: 'Error in expanding the bullet point',
                        status: 'error',
                        duration: 5000,
                        position: 'top-right',
                        isClosable: true,
                    })
                }
            }).catch(() => {
                console.log('Error calling GPT4: ')
            })
        } else {
            toast({
                title: 'Done reducing...',
                status: 'info',
                duration: 2000,
                position: 'top-right',
                isClosable: true,
            })

            // ripple effect of expansion onto the themes if they exist
            if (themes.length > 0) {
                const newThemes = themes.map((theme: { type: string, val: string, editable: boolean }, index: number) => {
                    if (theme['type'] === 'point') {
                        const val = theme['val']
                        const idxVal = newPoints.findIndex((point: bulletObject) => point.history[point.expand + 1] === val)
                        return {
                            ...theme,
                            val: newPoints[idxVal].history[newPoints[idxVal].expand]
                        }
                    } else {
                        return theme
                    }
                })

                console.log('Reduced themes:')
                console.log(newThemes)
                setThemes(newThemes)
            }
            setExpandButtonToggle(!expandButtonToggle)
            computeButtonClick(newTitle, 'expand')
        }
    }

    const toggleExpandSection = () => {
        setExpandSection(!expandSection)
    }

    const toggleExpandQuizSection = () => {
        setExpandQuizSection(!expandQuizSection)
    }

    const reorderThemes = (list: { type: string, val: string }[], startIndex: number, endIndex: number) => {
        const result = Array.from(list)
        const [removed] = result.splice(startIndex, 1)
        result.splice(endIndex, 0, removed)

        return result
    }

    const reorder = (list: bulletObject[], startIndex: number, endIndex: number) => {
        const result = Array.from(list)
        const [removed] = result.splice(startIndex, 1)
        result.splice(endIndex, 0, removed)

        return result
    }

    const onDrageEndThemes = (result: any) => {
        console.log('Result ', result)

        // dropped outside the list
        if (!result.destination) {
            return
        }

        const items = reorderThemes(
            themes,
            result.source.index,
            result.destination.index
        )

        setThemes(items)
    }

    const onDragEnd = (result: any) => {
        console.log('Result ', result)

        // dropped outside the list
        if (!result.destination) {
            return
        }

        const items = reorder(
            bulletPoints,
            result.source.index,
            result.destination.index
        )

        setBulletPoints(items)
    }

    // styles of the draggable note points
    const getBulletPointStyle = (isDragging: any, draggableStyle: any) => ({
        // some basic styles to make the items look a bit nicer
        userSelect: "none",
        padding: '1vw',
        margin: `0 0 1vh 0`,
        borderRadius: '10px',
        // change background colour if dragging
        background: isDragging ? "lightgreen" : "#FFF",

        // styles we need to apply on draggables
        ...draggableStyle
    })

    const handleContextMenu = (e: any) => {
        if (micronote) {
            e.preventDefault()
            e.stopPropagation()
        }
    }

    const handleMouseDown = (e: any, index: number) => {
        if (micronote && e.button === 2) {
            // Detect right mouse button (2)
            setDragging(true)
            setDraggingIndex(index)
            setInitialY(e.clientY)
        }
    }

    //calling openai api when expanding a single point from another function
    const expandSinglePoint = async (point: string, created_at: number, utc_time: number) => {
        const obj = {
            point: point,
            created_at: created_at,
            utc_time: utc_time,
        }

        const res = await callGPTForSinglePoint(obj, transcription)
        return res
    }

    //call openai api for a single point expansion
    const openAIHelper = (newPoints: bulletObject[]) => {
        const pointToBeUpdated = newPoints[draggingIndex]

        expandSinglePoint(pointToBeUpdated.history[pointToBeUpdated.expand], pointToBeUpdated.created_at, pointToBeUpdated.utc_time).then(res => {
            if (res) {
                const editTime = Date.now()
                newPoints = bulletPoints.map((bp, idx) => {
                    if (idx === draggingIndex) {
                        let edit = [...bp.edit]
                        edit.push([])
                        edit[bp.expand].push({ e_point: res, e_time: editTime })
                        return {
                            ...bp,
                            history: [...bp.history, res],
                            edit: edit,
                        }
                    } else {
                        return bp
                    }

                })
                setDraggingIndex(-1)
                setInitialY(0)
                setBulletPoints(() => newPoints)
            } else {
                toast({
                    title: 'Error...',
                    description: 'Error in expanding the bullet point',
                    status: 'error',
                    duration: 5000,
                    position: 'top-right',
                    isClosable: true,
                })
            }
        }).catch(() => alert('Error calling GPT-4...'))
    }

    const callGPTForSinglePointFromComponent = async (point: NotePoint, transcription: TranscriptLine[], index: number) => {
        const expandedPoint = expandPoint(point, transcription)
        const transcript = expandedPoint.transcript.join(".")

        const promptString = getFormattedPromptString()

        const PROMPT = promptString +
            "Transcript: ..." + transcript + "...\n" +
            "Summary: " + expandedPoint.point + "\n" +
            "Note:"

        const res = await openai.chat.completions.create({
            messages: [{ role: "system", content: PROMPT }],
            model: "gpt-3.5-turbo",
            stream: true,
            // seed: SEED,
            temperature: 0.2,
        })

        for await (const chunk of res) {
            console.log(`Point ${index}: ${chunk.choices[0]?.delta?.content}` || "")
            addToPointStream(index, chunk.choices[0]?.delta?.content || "")
        }

        return index
    }

    const addToPointStream = (index: number, chunk: any) => {
        const pointStreams = JSON.parse(localStorage.getItem('pointStreams') ?? '""')
        const pointStream = pointStreams[index]
        if (pointStream === '') {
            setDraggingIndex(-1)
            setInitialY(0)
        }

        pointStreams[index] += chunk
        localStorage.setItem('pointStreams', JSON.stringify(pointStreams))
        console.log(pointStreams)

        setBulletPoints(prevPoints => {
            let newPoints = [...prevPoints]
            let hst = [...newPoints[index].history]
            if (pointStream === '') {
                hst = [...hst, pointStreams[index]]
            } else {
                hst[index] = pointStreams[index]
            }
            newPoints[index].history = hst

            return newPoints
        })
    }

    const newOpenAIHelper = async (newPoints: bulletObject[]) => {
        const pointToBeUpdated = newPoints[draggingIndex]

        const obj = {
            point: pointToBeUpdated.history[pointToBeUpdated.expand],
            created_at: pointToBeUpdated.created_at,
            utc_time: pointToBeUpdated.utc_time,
        }

        await callGPTForSinglePointFromComponent(obj, transcription, draggingIndex)
    }

    const handleMouseUp = (e: any) => {
        if (micronote && dragging) {
            setDragging(false)
            const finalY = e.clientY

            //too short displacement
            if (Math.abs(finalY - initialY) < 30) return

            const isUpwards: boolean = finalY < initialY

            const newPoints = [...bulletPoints]
            if (isUpwards) newPoints[draggingIndex].expand = newPoints[draggingIndex].expand + 1
            else newPoints[draggingIndex].expand = Math.max(0, newPoints[draggingIndex].expand - 1)

            if (!isUpwards) {
                toast({
                    title: 'Compressing...',
                    description: 'Please wait while we compress the bullet point',
                    status: 'info',
                    duration: 2000,
                    position: 'top-right',
                    isClosable: true,
                })

                setDraggingIndex(-1)
                setInitialY(0)
                setBulletPoints(newPoints)
            } else {
                toast({
                    title: 'Expanding...',
                    description: 'Please wait while we expand the bullet point',
                    status: 'info',
                    duration: 2000,
                    position: 'top-right',
                    isClosable: true,
                })

                if (newPoints[draggingIndex].history.length > newPoints[draggingIndex].expand) {
                    setDraggingIndex(-1)
                    setInitialY(0)
                    setBulletPoints(newPoints)
                } else {
                    openAIHelper(newPoints)
                }
            }
        }
    }

    const extractThemes = (text: string) => {
        const themes: { [key: string]: string[] } = {}
        const topicRegex = /<Topic name="([^"]+)">([\s\S]*?)<\/Topic>/g

        let match: RegExpExecArray | null;
        while ((match = topicRegex.exec(text)) !== null) {
            const [, themeName, content] = match
            const points = content.match(/<p>(.*?)<\/p>/g)?.map(p => p.replace(/<\/?p>/g, '')) || []
            themes[themeName] = points
        }

        console.log('themes', themes)
        return themes;
    }

    const constructThemesToShow = (obj: { [key: string]: string[] }) => {
        let themes: { type: string, val: string, editable: boolean }[] = []
        for (const [topic, points] of Object.entries(obj)) {
            themes.push({ type: 'topic', val: topic, editable: false, })
            themes.push(...points.map((point: string) => ({ type: 'point', val: point, editable: false, })))
        }
        return themes
    }

    //theme sorting
    const handleTheme = () => {
        toast({
            title: 'Generating themes. Please wait...',
            status: 'info',
            duration: 2000,
            position: 'top-right',
            isClosable: true
        })

        const newPoints: string[] = bulletPoints.map((bulletPoint, index) => {
            return `${index + 1}. ${bulletPoint.history[bulletPoint.expand]}`
        })

        generateTheme(newPoints).then(res => {
            // console.log(res)
            const t = extractThemes(res)
            computeButtonClick(newTitle, 'theme')
            console.log('Themes generated: ')
            console.log(t)
            const t2 = constructThemesToShow(t)
            console.log('Themes to show: ')
            console.log(t2)
            setThemes(t2)
            setThemeOrTime('time')
        }).catch(e => {
            console.log(`Quiz error: ${e}`)
            toast({
                title: 'Error generating theme. Please try again...',
                status: 'info',
                duration: 2000,
                position: 'top-right',
                isClosable: true
            })
        })
    }

    const editTheme = (index: number) => {
        const newThemes = themes.map((theme: { type: string, val: string, editable: boolean }, idx: number) => {
            if (idx === index) {
                return {
                    ...theme,
                    editable: true,
                }
            } else {
                return theme
            }
        })

        setThemes(newThemes)
    }

    const changeTheme = (index: number, val: string) => {
        const newThemes = themes.map((theme: { type: string, val: string, editable: boolean }, idx: number) => {
            if (idx === index) {
                return {
                    ...theme,
                    val: val,
                }
            } else {
                return theme
            }
        })

        setThemes(newThemes)
    }

    const stopThemeEdit = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
        if (e.key === 'Enter') {
            const newThemes = themes.map((theme: { type: string, val: string, editable: boolean }, idx: number) => {
                if (idx === index) {
                    return {
                        ...theme,
                        editable: false,
                    }
                } else {
                    return theme
                }
            })

            setThemes(newThemes)
        }
    }
    //time sorting
    const handleSort = () => {
        setThemeOrTime('theme')
        const sortedBulletPoints = [...bulletPoints].sort((a, b) => a.created_at - b.created_at)
        console.log('Sorted bullet points: ')
        console.log(sortedBulletPoints)
        setBulletPoints(sortedBulletPoints)
        computeButtonClick(newTitle, 'time')
    }

    const extractQuizzesInformation = (quizzesText: any) => {
        const quizRegex = /<Question>(.*?)<\/Question>\s*<Choice>(.*?)<\/Choice>\s*<Choice>(.*?)<\/Choice>\s*<Choice>(.*?)<\/Choice>\s*<Choice>(.*?)<\/Choice>\s*<Answer>(.*?)<\/Answer>/gs

        const matches = Array.from(quizzesText.matchAll(quizRegex))

        const quizzes = matches.map((match: any) => {
            const [, question, option1, option2, option3, option4, answer] = match as any
            const options = [option1, option2, option3, option4]
            return { question, answer, options }
        })

        return quizzes
    }

    const handleQuiz = () => {
        toast({
            title: 'Starting quiz. Please wait...',
            status: 'info',
            duration: 2000,
            position: 'top-right',
            isClosable: true
        })

        setShowQuiz(1)

        const newPoints: string[] = bulletPoints.map((bulletPoint, index) => {
            return `${bulletPoint.history[bulletPoint.expand]}`
        })

        console.log(newPoints);

        generateQuiz(newPoints, summary).then(res => {
            // console.log(res)
            const qs = extractQuizzesInformation(res)
            // console.log(qs)
            setQuizzes(qs)
            setShowQuiz(2)
        }).catch(e => {
            console.log(`Quiz error: ${e}`)
            toast({
                title: 'Error generating quiz. Please try again...',
                status: 'info',
                duration: 2000,
                position: 'top-right',
                isClosable: true
            })
        })
    }

    //summarizing using the whole transcription
    const handleSummary = () => {
        if (summary !== '') {
            return
        }

        toast({
            title: 'Summarizing notes...',
            status: 'info',
            duration: 2000,
            position: 'top-right',
            isClosable: true
        })
        setShowSummary(!showSummary)

        let tr = ''
        for (let i = 0; i < transcription.length; i++) {
            tr += transcription[i].text
        }

        //http://localhost:3000/fetch-summary
        fetch('https://noteeline-backend.onrender.com/fetch-summary', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                transcript: tr
            }),
        }).then(res => res.json()).then(data => {
            console.log('Summary:')
            console.log(data)
            setSummary(data.response)
            addSummary(newTitle, data.response)
        }).catch(e => console.log(e))
    }

    //passing expanded note-points and transcript
    const noteTranscriptSummary = () => {
        toast({
            title: 'Summarizing notes from points...',
            status: 'info',
            duration: 2000,
            position: 'top-right',
            isClosable: true
        })
        let expanded_points = []
        for (let i = 0; i < bulletPoints.length; i++) {
            const point = { point: bulletPoints[i].history[bulletPoints[i].expand], created_at: bulletPoints[i].created_at, utc_time: bulletPoints[i].utc_time, }
            expanded_points.push(expandPointWithTranscript(point, transcription))
        }

        let points_str = '';
        for (let i = 0; i < expanded_points.length; i++) {
            points_str += `${expanded_points[i].point}`
        }

        generatepointsummary(points_str, summary).then(res => {
            console.log('summary from points ' + res)
            setSummary_P(res)
            addSummary_P(newTitle, res)
            setShowSummary(true)
        }).catch(e => {
            console.log(`Summary Point error: ${e}`)
            toast({
                title: 'Error generating summary. Please try again...',
                status: 'info',
                duration: 2000,
                position: 'top-right',
                isClosable: true
            })
        })
    }

    //download button-click stats
    const handleDownload = () => {
        const newPoints = bulletPoints.map((bulletPoint, idx) => {
            const p = { point: bulletPoint.history[bulletPoint.expand], created_at: bulletPoint.created_at, utc_time: bulletPoint.utc_time, }
            const expanded_p = expandPointWithTranscript(p, transcription)
            let note_taking_time = -1
            if (idx === 0) {
                note_taking_time = bulletPoint.created_at * 1000.0
            } else {
                note_taking_time = bulletPoint.utc_time - bulletPoints[idx - 1].utc_time
            }

            return {
                point: bulletPoint.point,
                fraction_transcript: expanded_p.transcript,
                // created_at: bulletPoint.created_at,
                utc_time: bulletPoint.utc_time,
                note_taking_time: note_taking_time,
                edit: bulletPoint.edit
            }
        })

        const obj = fetchButtonStats(newTitle)
        const url = isLink ? `www.youtube.com/watch?v=${embedId}` : ''
        let userLog: any = {
            buttonStats: obj,
            pauseCount: pauseCount,
            forwardCount: forwardCount,
            reverseCount: reverseCount,
            summary_t: summary,
            summary_p: summary_p,
            url: url,
        }
        userLog.editHistory = newPoints

        const jsonString = JSON.stringify(userLog, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);

        link.download = name.replace(/\s+/g, '') + 'bulletPointsData.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    //store state of quiz while changing panels
    const changeQuizInfo = (info: any) => {
        setQuizInfo(info)
    }

    return (
        <Grid
            h='137%'
            w='100%'
            templateRows='repeat(18, 1fr)'
            templateColumns='repeat(4, 1fr)'
            sx={{ overflowX: 'hidden', }}
        >
            {/* YouTube video player */}
            {/* <button onClick={testDrive}>Test</button> */}
            <GridItem rowSpan={6} colSpan={4} sx={{ borderBottom: '1px solid #000', }}>
                {
                    !isLink ?
                        <InputGroup
                            style={{ marginBottom: '5vh', width: '50%', marginLeft: '25%', marginTop: '1%', }}
                        >
                            <Input
                                placeholder='Enter a YouTube link...'
                                style={{ background: 'white', }}
                                onChange={(e: { target: { value: React.SetStateAction<string> } }) => setYtLink(e.target.value)}
                            />
                            <InputRightElement width='4.5rem' style={{ padding: '0.5vw', }}>
                                <Button h='1.75rem' size='sm' color='white' colorScheme='red' onClick={() => getYoutubeTranscription('')}>
                                    Submit
                                </Button>
                            </InputRightElement>
                        </InputGroup>
                        :
                        <YouTube
                            ref={ref}
                            opts={opts}
                            videoId={embedId}
                            onReady={loop}
                            onPlay={() => setPause(false)}
                            onPause={countPause}
                            onEnd={stopVideo}
                            style={{ marginTop: '0%', marginLeft: '15%', }}
                        />
                }
            </GridItem>
            {
                expandQuizSection ?
                    <GridItem rowSpan={7} colSpan={4} sx={{ padding: '10px', overflowY: 'auto', borderRight: '1px solid #000', }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', }}>
                            {showQuiz !== 0 ?
                                <div></div> :
                                <Tag size='lg' variant='solid' colorScheme='teal' sx={{ cursor: 'pointer', }} onClick={handleQuiz}>
                                    <TagLabel>Cue Questions</TagLabel>
                                    <TagRightIcon as={SunIcon} />
                                </Tag>
                            }
                            <ChevronLeftIcon w={8} h={8} color="tomato" sx={{ cursor: 'pointer', }} onClick={toggleExpandQuizSection} />
                        </div>
                        <br />
                        {
                            showQuiz === 2 ?
                                quizzes && quizzes.length > 0 ?
                                    <Quiz quizzes={quizzes} quizInfo={quizInfo} changeQuizInfo={changeQuizInfo} />
                                    :
                                    <p>No quizzes to show !</p>
                                :
                                showQuiz === 1 ?
                                    <p>Loading quizzes...</p>
                                    :
                                    <p>No quizzes to show !</p>
                        }
                    </GridItem>
                    :
                    expandSection || !micronote ?
                        <GridItem rowSpan={7} colSpan={4} sx={{ padding: '3px', paddingTop: '0', overflowY: 'auto', }}>
                            <div style={{ paddingTop: '1px', position: 'sticky', top: 0, zIndex: 1, background: '#fff', }}>
                                {micronote && <ChevronRightIcon w={8} h={8} color="tomato" sx={{ cursor: 'pointer', }} onClick={toggleExpandSection} />}
                                {
                                    micronote &&
                                    <Tag size='lg' variant='solid' colorScheme='yellow' sx={{ marginLeft: '1px', cursor: 'pointer', }} onClick={testDrive}>
                                        <TagLabel>{expandButtonToggle ? 'Reduce' : 'Expand'}</TagLabel>
                                        <TagRightIcon w={3} as={ArrowBackIcon} />
                                        <TagRightIcon w={3} as={ArrowForwardIcon} />
                                    </Tag>
                                }
                                {
                                    micronote && (
                                        themeOrTime === 'theme' ?
                                            <Tag size='lg' variant='solid' colorScheme='red' sx={{ marginLeft: '1px', cursor: 'pointer', }} onClick={handleTheme}>
                                                <TagLabel>Order by Theme</TagLabel>
                                                <TagRightIcon as={DragHandleIcon} />
                                            </Tag>
                                            :
                                            <Tag size='lg' variant='solid' colorScheme='green' sx={{ marginLeft: '1px', marginBottom: '1vh', cursor: 'pointer', }} onClick={handleSort}>
                                                <TagLabel>Order by Time</TagLabel>
                                                <TagRightIcon as={TimeIcon} />
                                            </Tag>
                                    )
                                }
                                {/* <Tag size='lg' variant='solid' colorScheme='blue' sx={{ padding: '0', marginLeft: '1px', marginBottom: '1vh', cursor: 'pointer', }} onClick={handleDownload}>
                            <TagRightIcon as={DownloadIcon} />
                        </Tag> */}
                            </div>
                            {themeOrTime !== 'time' ?
                                <DragDropContext onDragEnd={onDragEnd}>
                                    <Droppable droppableId="droppable">
                                        {(provided: any) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                            // style={getListStyle(snapshot.isDraggingOver)}
                                            >
                                                {bulletPoints.map((bulletPoint, index) => (
                                                    <Draggable key={bulletPoint.id} draggableId={bulletPoint.id} index={index}>
                                                        {(provided: any, snapshot: any) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                style={getBulletPointStyle(
                                                                    snapshot.isDragging,
                                                                    provided.draggableProps.style
                                                                )}
                                                                onContextMenu={handleContextMenu}
                                                                onMouseDown={(e) => handleMouseDown(e, index)}
                                                                onMouseUp={handleMouseUp}
                                                            >
                                                                {
                                                                    !bulletPoint.editable ?
                                                                        <BulletPoint
                                                                            key={index}
                                                                            index={index}
                                                                            expand={bulletPoint.expand}
                                                                            history={bulletPoint.history}
                                                                            created_at={bulletPoint.created_at}
                                                                            editPoint={editPoint}
                                                                            state={bulletPoint.state}
                                                                            tempString={bulletPoint.tempString}
                                                                        />
                                                                        :
                                                                        <textarea
                                                                            // type='text'
                                                                            defaultValue={bulletPoint.point}
                                                                            className='note-input'
                                                                            onChange={(e) => changeEditPoint(index, e.target.value)}
                                                                            onKeyDown={event => updateEditPoint(index, event)}
                                                                            rows={Math.max(Math.ceil(bulletPoint.point.length / 200), 1)}
                                                                        />
                                                                }
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
                                :
                                <DragDropContext onDragEnd={onDrageEndThemes}>
                                    <Droppable droppableId="droppable">
                                        {(provided: any) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                            // style={getListStyle(snapshot.isDraggingOver)}
                                            >
                                                {themes.map((theme: any, index: any) => (
                                                    <Draggable key={theme['val']} draggableId={theme['val']} index={index}>
                                                        {(provided: any, snapshot: any) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                style={getBulletPointStyle(
                                                                    snapshot.isDragging,
                                                                    provided.draggableProps.style
                                                                )}
                                                                onContextMenu={handleContextMenu}
                                                                onMouseDown={(e) => handleMouseDown(e, index)}
                                                                onMouseUp={handleMouseUp}
                                                            >
                                                                {theme['type'] === 'topic' ?
                                                                    !theme['editable'] ?
                                                                        <h4 style={{ color: '#000', fontWeight: 'bold', }}>
                                                                            {theme['val']} <EditIcon w={4} color='green.500' style={{ cursor: 'pointer', }} onClick={() => editTheme(index)} />
                                                                        </h4>
                                                                        :
                                                                        <input
                                                                            type='text'
                                                                            defaultValue={theme['val']}
                                                                            onChange={(e) => changeTheme(index, e.target.value)}
                                                                            onKeyDown={(e) => stopThemeEdit(e, index)}
                                                                        />
                                                                    :
                                                                    <p>{theme['val']}</p>
                                                                }
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </DragDropContext>
                            }
                            <input
                                type='text'
                                placeholder='Write a point...'
                                className='note-input'
                                value={newPoint}
                                onChange={(e) => setNewPoint(e.target.value)}
                                onKeyDown={event => handleKeyDown(event)}
                            />
                        </GridItem>
                        :
                        <>
                            <GridItem rowSpan={7} colSpan={2} sx={{ padding: '2px', overflowY: 'auto', borderRight: '1px solid #000', }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', }}>
                                    {showQuiz !== 0 ?
                                        <div></div> :
                                        <Tag size='lg' variant='solid' colorScheme='teal' sx={{ cursor: 'pointer', }} onClick={handleQuiz}>
                                            <TagLabel>Cue Questions</TagLabel>
                                            <TagRightIcon as={SunIcon} />
                                        </Tag>
                                    }
                                    <ChevronLeftIcon w={8} h={8} color="tomato" sx={{ cursor: 'pointer', }} onClick={toggleExpandSection} />
                                </div>
                                <br />
                                {
                                    showQuiz === 2 ?
                                        quizzes && quizzes.length > 0 ?
                                            <Quiz quizzes={quizzes} quizInfo={quizInfo} changeQuizInfo={changeQuizInfo} />
                                            :
                                            <p>No quizzes to show !</p>
                                        :
                                        showQuiz === 1 ?
                                            <p>Loading quizzes...</p>
                                            :
                                            <p>No quizzes to show !</p>
                                }
                            </GridItem>
                            <GridItem rowSpan={5} colSpan={2} sx={{ padding: '2px', paddingTop: '0', overflowY: 'auto', }}>
                                <div style={{ paddingTop: '1px', position: 'sticky', top: 0, zIndex: 1, background: '#fff', }}>
                                    <ChevronRightIcon w={8} h={8} color="tomato" sx={{ cursor: 'pointer', }} onClick={toggleExpandQuizSection} />
                                    {
                                        micronote &&
                                        <Tag size='lg' variant='solid' colorScheme='yellow' sx={{ marginLeft: '1px', cursor: 'pointer', }} onClick={testDrive}>
                                            <TagLabel>{expandButtonToggle ? 'Reduce' : 'Expand'}</TagLabel>
                                            <TagRightIcon w={3} as={ArrowBackIcon} />
                                            <TagRightIcon w={3} as={ArrowForwardIcon} />
                                        </Tag>
                                    }
                                    {
                                        themeOrTime === 'theme' ?
                                            <Tag size='lg' variant='solid' colorScheme='red' sx={{ marginLeft: '1px', cursor: 'pointer', }} onClick={handleTheme}>
                                                <TagLabel>Order by Theme</TagLabel>
                                                <TagRightIcon as={DragHandleIcon} />
                                            </Tag>
                                            :
                                            <Tag size='lg' variant='solid' colorScheme='green' sx={{ marginLeft: '1px', marginBottom: '1vh', cursor: 'pointer', }} onClick={handleSort}>
                                                <TagLabel>Order by Time</TagLabel>
                                                <TagRightIcon as={TimeIcon} />
                                            </Tag>
                                    }
                                    {/* <Tag size='lg' variant='solid' colorScheme='blue' sx={{ marginLeft: '1px', marginBottom: '1vh', cursor: 'pointer', }} onClick={handleDownload}>
                                <TagRightIcon as={DownloadIcon} />
                            </Tag> */}
                                </div>
                                {themeOrTime !== 'time' ?
                                    <DragDropContext onDragEnd={onDragEnd}>
                                        <Droppable droppableId="droppable">
                                            {(provided: any) => (
                                                <div
                                                    {...provided.droppableProps}
                                                    ref={provided.innerRef}
                                                // style={getListStyle(snapshot.isDraggingOver)}
                                                >
                                                    {bulletPoints.map((bulletPoint, index) => (
                                                        <Draggable key={bulletPoint.id} draggableId={bulletPoint.id} index={index}>
                                                            {(provided: any, snapshot: any) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    {...provided.dragHandleProps}
                                                                    style={getBulletPointStyle(
                                                                        snapshot.isDragging,
                                                                        provided.draggableProps.style
                                                                    )}
                                                                    onContextMenu={handleContextMenu}
                                                                    onMouseDown={(e) => handleMouseDown(e, index)}
                                                                    onMouseUp={handleMouseUp}
                                                                >
                                                                    {
                                                                        !bulletPoint.editable ?
                                                                            <BulletPoint
                                                                                key={index}
                                                                                index={index}
                                                                                expand={bulletPoint.expand}
                                                                                history={bulletPoint.history}
                                                                                created_at={bulletPoint.created_at}
                                                                                editPoint={editPoint}
                                                                                state={bulletPoint.state}
                                                                                tempString={bulletPoint.tempString}
                                                                            />
                                                                            :
                                                                            <textarea
                                                                                // type='text'
                                                                                defaultValue={bulletPoint.history[bulletPoint.expand]}
                                                                                className='note-input'
                                                                                onChange={(e) => changeEditPoint(index, e.target.value)}
                                                                                onKeyDown={event => updateEditPoint(index, event)}
                                                                                rows={Math.max(Math.ceil(bulletPoint.point.length / 100), 1)}
                                                                            />
                                                                    }
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </DragDropContext>
                                    :
                                    <DragDropContext onDragEnd={onDrageEndThemes}>
                                        <Droppable droppableId="droppable">
                                            {(provided: any) => (
                                                <div
                                                    {...provided.droppableProps}
                                                    ref={provided.innerRef}
                                                // style={getListStyle(snapshot.isDraggingOver)}
                                                >
                                                    {themes.map((theme: any, index: any) => (
                                                        <Draggable key={theme['val']} draggableId={theme['val']} index={index}>
                                                            {(provided: any, snapshot: any) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    {...provided.dragHandleProps}
                                                                    style={getBulletPointStyle(
                                                                        snapshot.isDragging,
                                                                        provided.draggableProps.style
                                                                    )}
                                                                    onContextMenu={handleContextMenu}
                                                                    onMouseDown={(e) => handleMouseDown(e, index)}
                                                                    onMouseUp={handleMouseUp}
                                                                >
                                                                    {theme['type'] === 'topic' ?
                                                                        !theme['editable'] ?
                                                                            <h4 style={{ color: '#000', fontWeight: 'bold', }}>
                                                                                {theme['val']} <EditIcon w={4} color='green.500' style={{ cursor: 'pointer', }} onClick={() => editTheme(index)} />
                                                                            </h4>
                                                                            :
                                                                            <input
                                                                                type='text'
                                                                                defaultValue={theme['val']}
                                                                                onChange={(e) => changeTheme(index, e.target.value)}
                                                                                onKeyDown={(e) => stopThemeEdit(e, index)}
                                                                            />
                                                                        :
                                                                        <p>{theme['val']}</p>
                                                                    }
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </DragDropContext>
                                }
                                <input
                                    type='text'
                                    placeholder='Write a point...'
                                    className='note-input'
                                    value={newPoint}
                                    onChange={(e) => setNewPoint(e.target.value)}
                                    onKeyDown={event => handleKeyDown(event)}
                                />
                            </GridItem>
                        </>
            }
            {/* Summarization */}
            <GridItem rowSpan={5} colSpan={4} sx={{ padding: '2px', borderTop: '1px solid #000', overflowY: 'auto', }}>
                <Tag size='lg' variant='solid' colorScheme='cyan' sx={{ marginLeft: '1px', cursor: 'pointer', }} onClick={noteTranscriptSummary}>
                    <TagLabel>Summary</TagLabel>
                    <TagRightIcon as={CalendarIcon} />
                </Tag>
                {showSummary &&
                    (micronote ?
                        <div style={{ padding: '1vw', }}>{summary_p}</div>
                        :
                        <div style={{ padding: '1vw', }}>{summary}</div>)
                }
            </GridItem>
        </Grid>
    )
}

export default CornellNote
