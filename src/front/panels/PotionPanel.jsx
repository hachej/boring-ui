import EditorPanel from './EditorPanel'

export default function PotionPanel(props) {
  return (
    <EditorPanel
      {...props}
      params={{
        ...(props?.params || {}),
        markdownEditor: 'potion',
      }}
    />
  )
}
